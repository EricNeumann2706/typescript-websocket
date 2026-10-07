import WebSocket, { Server } from 'ws';
import * as crypto from 'crypto';
import { DurableObject } from 'cloudflare:workers';
import { ClientSocket } from './models/clientSocket';
import { LoggerHelper } from './helpers/logger-helper';
import { Message } from './models/message';
import { GameServerHandler } from './handlers/game-server-handler';
import { ProtocolHelper } from './handlers/protocol-handler';

const CONFIG_PORT = 80;

export interface Env {
	WEBSOCKET_SERVER: DurableObjectNamespace<LobbyObject>;
	SECRET_KEY: string; // OR: the default one I use: '9317e4d6-83b3-4188-94c4-353a2798d3c1'
	TURN_KEY: string;
	NEXT_FEST_SECRET: string;
}

// Formatted like a Godot Peer (int), but toString(), or else Godot will parse it as a float, not int.
// See: https://docs.godotengine.org/en/3.2/classes/class_jsonparseresult.html
function userId() {
	return Math.abs(new Int32Array(crypto.randomBytes(4).buffer)[0]).toString();
}

async function createChallengeCode(
	score: number,
	secret: string
): Promise<string> {

	const scorePart = score.toString(36).toUpperCase();

	const randomBytes = new Uint8Array(4);
	crypto.getRandomValues(randomBytes);

	const noncePart = bytesToBase32(randomBytes);

	const payload = `MAP1-${scorePart}-${noncePart}`;

	const encoder = new TextEncoder();

	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{
			name: 'HMAC',
			hash: 'SHA-256'
		},
		false,
		['sign']
	);

	const signatureBuffer = await crypto.subtle.sign(
		'HMAC',
		key,
		encoder.encode(payload)
	);

	const fullSignature = new Uint8Array(signatureBuffer);

	// 80 Bit reichen für unseren Verification Code völlig aus
	const shortSignature = fullSignature.slice(0, 10);

	const signaturePart = bytesToBase32(shortSignature);

	return `${payload}-${signaturePart}`;
}


function bytesToBase32(bytes: Uint8Array): string {

	const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

	let output = '';
	let buffer = 0;
	let bitsInBuffer = 0;

	for (const byte of bytes) {

		buffer = (buffer << 8) | byte;
		bitsInBuffer += 8;

		while (bitsInBuffer >= 5) {

			const shift = bitsInBuffer - 5;

			output += alphabet[
				(buffer >>> shift) & 31
			];

			bitsInBuffer -= 5;

			// Nur noch die nicht verbrauchten Bits behalten.
			if (bitsInBuffer === 0) {
				buffer = 0;
			}
			else {
				buffer &= (1 << bitsInBuffer) - 1;
			}
		}
	}

	if (bitsInBuffer > 0) {
		output += alphabet[
			(buffer << (5 - bitsInBuffer)) & 31
		];
	}

	return output;
}

// Worker
export default {
	async fetch(request, env, ctx): Promise<Response> {

			const url = new URL(request.url);

			// Next Fest Challenge Code
			if (
				request.method === 'POST' &&
				url.pathname === '/next-fest-code'
			) {
				try {
					const body = await request.json() as { score?: number };
					const score = body.score;

					if (
						!Number.isSafeInteger(score) ||
						score < 0 ||
						score > 2147483647
					) {
						return Response.json(
							{ success: false, error: 'Invalid score' },
							{ status: 400 }
						);
					}

					const code = await createChallengeCode(
						score,
						env.NEXT_FEST_SECRET
					);

					return Response.json({
						success: true,
						code: code
					});
				}
				catch (err) {
					return Response.json(
						{ success: false, error: 'Could not generate code' },
						{ status: 500 }
					);
				}
			}


			// Ab hier dein bisheriger WebSocket-Code
			const upgradeHeader = request.headers.get('Upgrade');

			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Durable Object expected Upgrade: websocket', {
					status: 426,
				});
			}

			let id = env.WEBSOCKET_SERVER.idFromName('foo');
			let stub = env.WEBSOCKET_SERVER.get(id);

			return stub.fetch(request);
		},
	} satisfies ExportedHandler<Env>;

// Durable Object
export class LobbyObject extends DurableObject {
	secretKey: string;
	currentlyConnectedWebSockets: number;
	gameServer: GameServerHandler;
	turnKey: string;

	constructor(ctx: DurableObjectState, env: Env) {
		// This is reset whenever the constructor runs because
		// regular WebSockets do not survive Durable Object resets.
		//
		// WebSockets accepted via the Hibernation API can survive
		// a certain type of eviction, but we will not cover that here.
		super(ctx, env);
		this.gameServer = new GameServerHandler();
		this.currentlyConnectedWebSockets = 0;
		this.secretKey = env.SECRET_KEY || '9317e4d6-83b3-4188-94c4-353a2798d3c1';
		this.turnKey = env.TURN_KEY;
	}

	async fetch(request: Request): Promise<Response> {
		// Creates two ends of a WebSocket connection.
		const webSocketPair = new WebSocketPair();

		// AD NOTE: Trying to use client as `ws`...
		const [client, server] = Object.values(webSocketPair);

		// Calling `accept()` tells the runtime that this WebSocket is to begin terminating
		// request within the Durable Object. It has the effect of "accepting" the connection,
		// and allowing the WebSocket to send and receive messages.
		server.accept();
		this.currentlyConnectedWebSockets += 1;

		// TODO: better typing?
		// AD NOTE: Trying to use server as `ws`...
		const clientSocket: ClientSocket = new ClientSocket(server, userId());
		this.gameServer.addClient(clientSocket);

		// // Upon receiving a message from the client, the server replies with the same message,
		// // and the total number of connections with the "[Durable Object]: " prefix
		server.addEventListener('message', (event: MessageEvent) => {
			// if message type...
			// server.send(`[Durable Object] currentlyConnectedWebSockets: ${this.currentlyConnectedWebSockets}`);
			const decodeMessage = new TextDecoder().decode(event.data as any);
			const parsedMessage: Message = Message.fromString(decodeMessage.toString());
			ProtocolHelper.parseReceivingMessage(this.gameServer, clientSocket, parsedMessage, this.secretKey, this.turnKey);
		});

		// // If the client closes the connection, the runtime will close the connection too.

		// TODO: Not sure who needs to close here...
		server.addEventListener('close', (cls: CloseEvent) => {
			// this.currentlyConnectedWebSockets -= 1;
			this.gameServer.removeClient(clientSocket.id);
			LoggerHelper.logInfo(`Connection closed for ${clientSocket.id}`);
			// client.close();
			server.close();
		});

		// TODO: Not sure who needs to close here
		server.addEventListener('error', (err) => {
			// this.gameServer.removeClient(clientSocket.id);
			LoggerHelper.logWarn(`WS Error for ${clientSocket.id}: ${err.message}`);
			// client.close();
			// server.close();
		});

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}
}
