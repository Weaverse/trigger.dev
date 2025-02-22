import type {
  Client as PulsarClient,
  Consumer as PulsarConsumer,
  ConsumerConfig as PulsarConsumerConfig,
  Message as PulsarMessage,
} from "pulsar-client";
import { Logger } from "../logger";
import {
  MessageCatalogSchema,
  MessageData,
  MessageDataSchema,
} from "./messageCatalogSchema";

import { z, ZodError } from "zod";
import { ZodPubSubStatus } from "./types";

export type SubscriberMessageAttributes = {
  messageId: string;
  eventTimestamp?: Date;
  publishedTimestamp: Date;
  redeliveryCount: number;
};

export type ZodSubscriberHandlers<
  TConsumerSchema extends MessageCatalogSchema
> = {
  [K in keyof TConsumerSchema]: (
    id: string,
    data: z.infer<TConsumerSchema[K]["data"]>,
    properties: z.infer<TConsumerSchema[K]["properties"]>,
    attributes: SubscriberMessageAttributes
  ) => Promise<boolean>;
};

export type ZodSubscriberOptions<
  SubscriberSchema extends MessageCatalogSchema
> = {
  client: PulsarClient;
  config: Omit<PulsarConsumerConfig, "listener">;
  schema: SubscriberSchema;
  handlers: ZodSubscriberHandlers<SubscriberSchema>;
};

export class ZodSubscriber<SubscriberSchema extends MessageCatalogSchema> {
  #config: Omit<PulsarConsumerConfig, "listener">;
  #schema: SubscriberSchema;
  #handlers: ZodSubscriberHandlers<SubscriberSchema>;

  #subscriber?: PulsarConsumer;
  #client: PulsarClient;
  #status: ZodPubSubStatus = "waitingToConnect";

  #logger: Logger;

  constructor(options: ZodSubscriberOptions<SubscriberSchema>) {
    this.#config = options.config;
    this.#schema = options.schema;
    this.#handlers = options.handlers;
    this.#client = options.client;
    this.#logger = new Logger("trigger.dev subscriber");
  }

  public async initialize(): Promise<boolean> {
    if (this.#status !== "waitingToConnect") {
      return this.#status === "ready";
    }

    this.#status = "initializing";

    try {
      this.#logger.debug(
        `Initializing subscriber with config ${JSON.stringify(this.#config)}`
      );

      this.#subscriber = await this.#client.subscribe({
        ...this.#config,
        listener: this.#onMessage.bind(this),
      });

      this.#status = "ready";

      return true;
    } catch (e) {
      this.#status = "error";

      this.#logger.error("Error initializing subscriber", e);

      return false;
    }
  }

  public async close() {
    if (this.#subscriber && this.#subscriber.isConnected()) {
      await this.#subscriber.close();
      this.#subscriber = undefined;
    }
  }

  #getRawProperties(msg: PulsarMessage): Record<string, string> {
    const properties = msg.getProperties();

    if (Array.isArray(properties)) {
      return Object.keys(properties).reduce((acc, key) => {
        acc[key] = properties[key];

        return acc;
      }, {} as Record<string, string>);
    }

    return properties;
  }

  async #onMessage(msg: PulsarMessage, consumer: PulsarConsumer) {
    const messageData = MessageDataSchema.parse(
      JSON.parse(msg.getData().toString())
    );

    const properties = this.#getRawProperties(msg);

    const messageId = msg.getMessageId();
    const publishedTimestamp = msg.getPublishTimestamp();
    const eventTimestamp = msg.getEventTimestamp();
    const redeliveryCount = msg.getRedeliveryCount();

    this.#logger.debug("#onMessage", {
      messageId,
      publishedTimestamp,
      eventTimestamp,
      redeliveryCount,
    });

    const messageAttributes = {
      eventTimestamp:
        eventTimestamp === 0 ? undefined : new Date(eventTimestamp),
      messageId: messageId.toString(),
      publishedTimestamp: new Date(publishedTimestamp),
      redeliveryCount,
    };

    try {
      const wasHandled = await this.#handleMessage(
        messageData,
        properties,
        messageAttributes
      );

      if (wasHandled) {
        await consumer.acknowledge(msg);
      }
    } catch (e) {
      if (e instanceof ZodError) {
        this.#logger.error(
          "[ZodSubscriber] Received invalid message data or properties",
          messageData,
          properties,
          e.format()
        );
      } else {
        this.#logger.error("[ZodSubscriber] Error handling message", e);
      }

      // TODO: Add support for dead letter queue
      await consumer.acknowledge(msg);
    }
  }

  async #handleMessage<K extends keyof SubscriberSchema>(
    rawMessage: MessageData,
    rawProperties: Record<string, string> = {},
    messageAttributes: SubscriberMessageAttributes
  ): Promise<boolean> {
    const subscriberSchema = this.#schema;
    type TypeKeys = keyof typeof subscriberSchema;
    const typeName = rawMessage.type as TypeKeys;

    const messageSchema: SubscriberSchema[TypeKeys] | undefined =
      subscriberSchema[typeName];

    if (!messageSchema) {
      throw new Error(`Unknown message type: ${rawMessage.type}`);
    }

    const message = messageSchema.data.parse(rawMessage.data);
    const properties = messageSchema.properties.parse(rawProperties);

    this.#logger.debug("Received message, calling handler", {
      topic: this.#config.topic,
      subscription: this.#config.subscription,
      type: rawMessage.type,
      message,
      properties,
    });

    const handler = this.#handlers[typeName];

    const returnValue = await handler(
      rawMessage.id,
      message,
      properties,
      messageAttributes
    );

    return returnValue;
  }
}
