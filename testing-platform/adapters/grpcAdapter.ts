import { AccountServiceClient } from "@beadsmith-grpc/account"
import { BrowserServiceClient } from "@beadsmith-grpc/browser"
import { CheckpointsServiceClient } from "@beadsmith-grpc/checkpoints"
import { CommandsServiceClient } from "@beadsmith-grpc/commands"
import { FileServiceClient } from "@beadsmith-grpc/file"
import { McpServiceClient } from "@beadsmith-grpc/mcp"
import { ModelsServiceClient } from "@beadsmith-grpc/models"
import { SlashServiceClient } from "@beadsmith-grpc/slash"
import { StateServiceClient } from "@beadsmith-grpc/state"
import { TaskServiceClient } from "@beadsmith-grpc/task"
import { UiServiceClient } from "@beadsmith-grpc/ui"
import { WebServiceClient } from "@beadsmith-grpc/web"
import { credentials } from "@grpc/grpc-js"
import { promisify } from "util"

const serviceRegistry = {
	"beadsmith.AccountService": AccountServiceClient,
	"beadsmith.BrowserService": BrowserServiceClient,
	"beadsmith.CheckpointsService": CheckpointsServiceClient,
	"beadsmith.CommandsService": CommandsServiceClient,
	"beadsmith.FileService": FileServiceClient,
	"beadsmith.McpService": McpServiceClient,
	"beadsmith.ModelsService": ModelsServiceClient,
	"beadsmith.SlashService": SlashServiceClient,
	"beadsmith.StateService": StateServiceClient,
	"beadsmith.TaskService": TaskServiceClient,
	"beadsmith.UiService": UiServiceClient,
	"beadsmith.WebService": WebServiceClient,
} as const

export type ServiceClients = {
	-readonly [K in keyof typeof serviceRegistry]: InstanceType<(typeof serviceRegistry)[K]>
}

export class GrpcAdapter {
	private clients: Partial<ServiceClients> = {}

	constructor(address: string) {
		for (const [name, Client] of Object.entries(serviceRegistry)) {
			this.clients[name as keyof ServiceClients] = new (Client as any)(address, credentials.createInsecure())
		}
	}

	async call(service: keyof ServiceClients, method: string, request: any): Promise<any> {
		const client = this.clients[service]
		if (!client) {
			throw new Error(`No gRPC client registered for service: ${String(service)}`)
		}

		const fn = (client as any)[method]
		if (typeof fn !== "function") {
			throw new Error(`Method ${method} not found on service ${String(service)}`)
		}

		try {
			const fnAsync = promisify(fn).bind(client)
			const response = await fnAsync(request.message)
			return response?.toObject ? response.toObject() : response
		} catch (error) {
			console.error(`[GrpcAdapter] ${service}.${method} failed:`, error)
			throw error
		}
	}

	close(): void {
		for (const client of Object.values(this.clients)) {
			if (client && typeof (client as any).close === "function") {
				;(client as any).close()
			}
		}
	}
}
