import type { PrismaClient } from "~/db.server";
import { prisma } from "~/db.server";

export class ResolveDelay {
  #prismaClient: PrismaClient;

  constructor(prismaClient: PrismaClient = prisma) {
    this.#prismaClient = prismaClient;
  }

  async call(id: string) {
    const existingDelay = await this.#prismaClient.durableDelay.findUnique({
      where: { id },
      include: {
        step: {
          include: {
            run: {
              include: { environment: true },
            },
          },
        },
      },
    });

    if (!existingDelay) {
      throw new Error("Delay not found");
    }

    if (existingDelay.resolvedAt) {
      return existingDelay;
    }

    const delay = await this.#prismaClient.durableDelay.update({
      where: { id },
      data: { resolvedAt: new Date() },
      include: {
        step: {
          include: {
            run: {
              include: { environment: true },
            },
          },
        },
      },
    });

    await this.#prismaClient.workflowRunStep.update({
      where: { id: delay.step.id },
      data: { status: "SUCCESS", finishedAt: delay.resolvedAt },
    });

    return delay;
  }
}
