import { EAction } from '../base/enumerators';
import { ClientSocket } from '../models/clientSocket';
import { Lobby, LobbyBot } from '../models/lobby';
import { Message } from '../models/message';

import { GameServerHandler } from './game-server-handler';
import { LoggerHelper } from '../helpers/logger-helper';
import { TurnHelper, TurnResponse } from '../helpers/turn-helper';

export class ProtocolHelper {
	public static sendPlayerDisconnectToAll = (gameServer: GameServerHandler, playerDisconnectedId: string) => {
		const playerDisconnectedMessage: Message = new Message(EAction.PlayerLeft, {
			webId: playerDisconnectedId,
		});
		try {
			for (const client of gameServer.connectedClients) {
				try {
					client.socket.send(playerDisconnectedMessage.toString());
				} catch (err: any) {
					LoggerHelper.logError(
						`[ProtocolHelper.sendPlayerDisconnectToAll()] An error had occurred while sending message to client ${client.id}. \n Error: ${err}`
					);
				}
			}
		} catch (err: any) {
			LoggerHelper.logError(
				`[ProtocolHelper.sendPlayerDisconnectToAll()] An error had occurred while notifing a server disconnection: ${err}`
			);
		}
	};

	public static sendPlayerConnectionToAll = (gameServer: GameServerHandler, playerClient: ClientSocket) => {
		const playerConnectedMessage: Message = new Message(EAction.PlayerJoin, {
			username: playerClient.username,
			id: playerClient.id,
			leader: playerClient.leader,
			team: playerClient.team,
			lobbyId: playerClient.lobbyId,
		});
		try {
			for (const client of gameServer.connectedClients) {
				try {
					if (client.id != playerClient.id) {
						client.socket.send(playerConnectedMessage.toString());
					}
				} catch (err: any) {
					LoggerHelper.logError(
						`[ProtocolHelper.sendPlayerConnectionToAll()] An error had occurred while sending message to client ${client.id}. \n Error: ${err}`
					);
				}
			}
		} catch (err: any) {
			LoggerHelper.logError(
				`[ProtocolHelper.sendPlayerConnectionToAll()] An error had occurred while notifing a server disconnection: ${err}`
			);
		}
	};

	public static parseReceivingMessage = (
		gameServer: GameServerHandler,
		clientSocket: ClientSocket,
		message: Message,
		secretKey: string,
		turnKey: string // TODO: bad
	) => {
		try {
			switch (message.action) {
				case EAction.Confirm:
					ProtocolHelper.connectToServer(gameServer, clientSocket, message, secretKey);
					break;
				case EAction.GetUsers:
					ProtocolHelper.sendUserList(gameServer, clientSocket);
					break;
				case EAction.GetLobbies:
					ProtocolHelper.sendLobbyList(gameServer, clientSocket);
					break;
				case EAction.GetOwnLobby:
					ProtocolHelper.sendLobby(gameServer, clientSocket);
					break;
				case EAction.CreateLobby:
					ProtocolHelper.createNewLobby(gameServer, clientSocket, message);
					break;
				case EAction.LeaveLobby:
					ProtocolHelper.leaveLobby(gameServer, clientSocket, message);
					break;
				case EAction.JoinLobby:
					ProtocolHelper.joinExistingLobby(gameServer, clientSocket, message);
					break;
				case EAction.LobbyChanged:
					ProtocolHelper.updateLobbyData(gameServer, clientSocket, message);
					break;
				case EAction.PlayerInfoUpdate:
					ProtocolHelper.playerUpdateInfo(gameServer, clientSocket, message);
					break;
				case EAction.AddBot:
					ProtocolHelper.addBot(gameServer, clientSocket)
					break
				case EAction.SetLobbyPrivacy:
					ProtocolHelper.setLobbyPrivacy(gameServer, clientSocket, message);
					break;
				case EAction.RemoveBot:
					ProtocolHelper.removeBot(gameServer, clientSocket, message)
					break
				case EAction.UpdateBot:
					ProtocolHelper.updateBot(gameServer, clientSocket, message)
					break
				case EAction.MessageToLobby:
					ProtocolHelper.sendMessageToLobby(gameServer, clientSocket, message);
					break;
				case EAction.GameStarted:
					LoggerHelper.logInfo('Recieved Lobby Start ' + message);
					ProtocolHelper.startGameForLobby(gameServer, clientSocket, message, turnKey);
					break;
				case EAction.Offer:
				case EAction.Answer:
				case EAction.Candidate:
					// console.log('DEBUG OFFER', gameServer, clientSocket, message)
					ProtocolHelper.sendOfferAnswerOrCandidate(gameServer, clientSocket, message);
					break;
				case EAction.KickPlayer:
					ProtocolHelper.kickPlayer(gameServer, clientSocket, message);
					break;
			}
		} catch (err) {
			LoggerHelper.logError(`[ProtocolHelper.parseReceivingMessage()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static connectToServer = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message, secretKey: string) => {
		try {
			LoggerHelper.logInfo('Connection attempt...');
			if (message.payload.secretKey === secretKey) {
				clearTimeout(clientSocket.logoutTimeout);
				clientSocket.username = message.payload.username;
				LoggerHelper.logInfo(`Connection confirmed for ${clientSocket.id}`);

				// Send response
				const connectMessage: Message = new Message(EAction.Confirm, {
					webId: clientSocket.id,
				});
				clientSocket.socket.send(connectMessage.toString());

				// Notifies other clients
				for (const client of gameServer.connectedClients) {
					ProtocolHelper.sendUserList(gameServer, client);
				}
			} else {
				LoggerHelper.logWarn(`Connection failed for ${clientSocket.id}`);
				clearTimeout(clientSocket.logoutTimeout);
				clientSocket.socket.close();
				return false;
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.connectToServer()] An error had occurred while parsing a message: ${err}`);
		}
	};

	public static sendUserList = (gameServer: GameServerHandler, clientSocket: ClientSocket) => {
		try {
			const userListMessage: Message = new Message(EAction.GetUsers, {
				users: gameServer.connectedClients.map(({ username, id, lobbyId, leader, team }) => {
					return {
						username,
						id,
						lobbyId,
						leader,
						team,
					};
				}),
			});
			clientSocket.socket.send(userListMessage.toString());
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendUserList()] An error had occurred while parsing a message: ${err}`);
		}
	};

	public static sendLobbyList = (gameServer: GameServerHandler, clientSocket: ClientSocket) => {
		try {
			const lobbyListMessage: Message = new Message(EAction.GetLobbies, {
				lobbies: gameServer.getLobbies(),
			});
			clientSocket.socket.send(lobbyListMessage.toString());
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendLobbies()] An error had occurred while parsing a message: ${err}`);
		}
	};

	public static sendLobby = (gameServer: GameServerHandler, clientSocket: ClientSocket) => {
		try {
			const lobby: Lobby | undefined = gameServer.getLobbyByPlayerId(clientSocket.id);
			if (!!lobby) {
				const message = new Message(EAction.GetOwnLobby, {
					lobby: lobby.get(),
				});
				clientSocket.socket.send(message.toString());
			} else {
				// send empty if no lobby
				const message = new Message(EAction.GetOwnLobby, {});
				clientSocket.socket.send(message.toString());
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static createNewLobby = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) => {
		try {
			console.log('MEASAGE', message);
			if (gameServer.getLobbyByPlayerId(clientSocket.id)) {
				LoggerHelper.logWarn(`Client ${clientSocket.id} is requesting a new lobby while inside a lobby.`);
				// const invalidLobbyMessage = new Message(EAction.CreateLobby, {
				// 	success: false,
				// });
				// clientSocket.socket.send(invalidLobbyMessage.toString());

				return false;
			} else {
				LoggerHelper.logInfo(`Client ${clientSocket.id} created a new lobby.`);
				const newLobby = gameServer.createLobby(message);
				newLobby.addPlayer(clientSocket);

				const createLobbySuccessMessage = new Message(EAction.CreateLobby, { lobby: newLobby });
				clientSocket.socket.send(createLobbySuccessMessage.toString());
				// Alert all clients the changes to the lobbies
				gameServer.connectedClients.forEach((el) => {
					ProtocolHelper.sendLobbyList(gameServer, el);
				});

				ProtocolHelper.sendLobbyChanged(clientSocket, newLobby);
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.createNewLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static setLobbyPrivacy(gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) {
    try {
        const lobby = gameServer.getLobbyByPlayerId(clientSocket.id);
        if (!lobby) return;

        // Payload erwartet { isPublic: boolean }
        const { isPublic } = message.payload;
        if (typeof isPublic !== "boolean") return;

        lobby.setPrivacy(isPublic);

        // Erfolgreiche Rückmeldung an den Host
        clientSocket.socket.send(new Message(EAction.SetLobbyPrivacy, { success: true, lobby: lobby.get() }).toString());

        // Broadcast an alle Spieler
        lobby.players.forEach(p => {
            if (p.id !== clientSocket.id) {
                ProtocolHelper.sendLobbyChanged(p, lobby);
            }
        });

    } catch (err) {
        LoggerHelper.logError(`[ProtocolHelper.setLobbyPrivacy()] ${err}`);
    }
}

	private static updateLobbyData = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) => {
		try {
			const lobby = gameServer.getLobbyByPlayerId(clientSocket.id);
			const isHost = lobby?.players[0].id === clientSocket.id;
			if (!isHost) {
				LoggerHelper.logWarn(`Client ${clientSocket.id} requested to change a lobby while not a host.`);
				return false;
			}

			if (!message.payload) {
				return false;
			}

			// Update direkt die Lobby-Eigenschaften -> wird mittlerweile nur noch settings genommen. Bots über explizite Methoden
			const payloadKeys = Object.keys(message.payload) as (keyof Lobby)[];
			payloadKeys.forEach(key => {
				if (key in lobby) {
					if (message.payload.settings)
						lobby.settings = message.payload.settings
				}
			});

			// Broadcast an alle Spieler
			ProtocolHelper.broadcastLobby(lobby)
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.updateLobbyData()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static broadcastLobby(lobby: Lobby) {
		lobby.players.forEach(p =>
			ProtocolHelper.sendLobbyChanged(p, lobby)
		)
	}

	private static leaveLobby = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) => {
		try {
			const lobby = gameServer.getLobbyByPlayerId(clientSocket.id);
			if (!!lobby) {
				lobby.removePlayer(clientSocket.id);
				ProtocolHelper.sendLobbyChanged(clientSocket);

				const leaveLobbySuccessMessage = new Message(EAction.LeaveLobby, {});
				clientSocket.socket.send(leaveLobbySuccessMessage.toString());
				// If the lobby is empty, erase it
				if (lobby.players.length === 0) {
					gameServer.removeLobby(lobby.id);
				} else {
					for (let el of lobby.players) {
						el.socket.send(
							new Message(EAction.PlayerLeft, {
								webId: clientSocket.id,
							}).toString()
						);
						// ProtocolHelper.sendLobbyChanged(clientSocket, lobby);
					}
				}
				// Alert all clients the changes to the lobbies
				gameServer.connectedClients.forEach((el) => ProtocolHelper.sendLobbyList(gameServer, el));
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.leaveLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static kickPlayer = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) => {
		try {
			const lobby = gameServer.getLobbyByPlayerId(clientSocket.id);
			const isHost = lobby?.players[0].id === clientSocket.id;
			const clientSocketToKick = lobby?.players.find((client) => client.id === message.payload.id);

			if (!isHost || lobby.players.length < 2) {
				return;
			}

			if (!!lobby) {
				lobby.playerIdsBanned.push(message.payload.id);
				lobby.removePlayer(message.payload.id);

				const kickMessage = new Message(EAction.KickPlayer, {});
				clientSocketToKick?.socket.send(kickMessage.toString());

				const messageLobbyEvent = new Message(EAction.LobbyEvent, {
					message: clientSocketToKick?.username + ' was kicked from the game.',
				});
				lobby.players.forEach((el) => {
					el.socket.send(messageLobbyEvent.toString());
				});

				gameServer.connectedClients.forEach((el) => ProtocolHelper.sendLobbyList(gameServer, el));
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.leaveLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static addBot(gameServer: GameServerHandler, clientSocket: ClientSocket) {
		const lobby = gameServer.getLobbyByPlayerId(clientSocket.id)
		if (!lobby) return

		const bot = new LobbyBot(
			"Bot_" + Math.floor(Math.random() * 9999),
			"Hatshepsut",
			1,
			0
		)

		lobby.addBot(bot)

		ProtocolHelper.broadcastLobby(lobby)
	}

	private static removeBot(gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) {
		const lobby = gameServer.getLobbyByPlayerId(clientSocket.id)
		if (!lobby) return

		lobby.removeBot(message.payload.username)

		ProtocolHelper.broadcastLobby(lobby)
	}

	private static updateBot(gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) {
		const lobby = gameServer.getLobbyByPlayerId(clientSocket.id)
		if (!lobby) return

		const { username, ...data } = message.payload

		lobby.updateBot(username, data)

		ProtocolHelper.broadcastLobby(lobby)
	}

	private static joinExistingLobby = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) => {
		try {
			const lobbyToJoin: Lobby | undefined = gameServer.getLobbyById(message.payload.id);
			if (!!lobbyToJoin) {
				
				// If the player is already in a lobby, do not allow them to join a new one
				if (clientSocket.lobbyId.length > 1) {
					const joinLobbyFailureMessage = new Message(EAction.JoinLobby, {
						success: false,
					});
					clientSocket.socket.send(joinLobbyFailureMessage.toString());
					return;
				}

				// Prüfen, ob private Lobby und dann code checken
				if (!lobbyToJoin.isPublic) {
					const code = message.payload.code;
					if (!code || code != lobbyToJoin.joinCode) {
						clientSocket.socket.send(new Message(EAction.JoinLobby, { success: false, reason: "INVALID_CODE" }).toString());
						return;
					}
				}



				if (lobbyToJoin.addPlayer(clientSocket)) {
					const joinLobbySuccessMessage = new Message(EAction.JoinLobby, {
						lobby: lobbyToJoin,
					});
					clientSocket.socket.send(joinLobbySuccessMessage.toString());

					// Alert all clients the changes to the lobbies
					gameServer.connectedClients.forEach((el) => ProtocolHelper.sendLobbyList(gameServer, el));
					lobbyToJoin.players.forEach((el) => {
						ProtocolHelper.sendLobbyChanged(el, lobbyToJoin);
					});

					// THIS IS DROP IN:  Join

					// Step 1: Send existing players to new player
					// Step 2: send new player to all existing players

					if (lobbyToJoin.players.length >= 2 && lobbyToJoin.isGameStarted) {
						setTimeout(() => {
							var new_player_client = clientSocket;
							// New player gets all lobby:
							for (const next_player of lobbyToJoin.players) {
								if (new_player_client.id !== next_player.id) {
									ProtocolHelper.sendNewPeerConnection(new_player_client, next_player.id);
								}
							}

							lobbyToJoin.players.forEach((player) => {
								// Start
								// Share all about the new player via new sendNewPeerConnection
								var player_client: ClientSocket = player;
								if (new_player_client.id !== player_client.id) {
									ProtocolHelper.sendNewPeerConnection(player_client, new_player_client.id);
								}
							});

							// // New player
							// clientSocket
							// lobbyToJoin.players.forEach((player) => {
							// 	// Start
							// 	// Share all new sendNewPeerConnection
							// 	var player_client: ClientSocket = player;
							// 	var current_player_id: string = player.id;
							// 	for (const next_player of lobbyToStart.players) {
							// 		if (current_player_id !== next_player.id) {
							// 			ProtocolHelper.sendNewPeerConnection(player_client, next_player.id);
							// 		}
							// 	}
							// });
						}, 1000);
					}
				} else {
					const joinLobbyFailureMessage = new Message(EAction.JoinLobby, {
						success: false,
					});
					clientSocket.socket.send(joinLobbyFailureMessage.toString());
				}
			} else {
				const joinLobbyFailureMessage = new Message(EAction.JoinLobby, {
					success: false,
				});
				clientSocket.socket.send(joinLobbyFailureMessage.toString());
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.joinExistingLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};

	private static startGameForLobby = async (
		gameServer: GameServerHandler,
		clientSocket: ClientSocket,
		message: Message,
		turnKey: String
	) => {
		try {
			// const lobbyToStart: Lobby | undefined = gameServer.getLobbyById(message.payload.id);
			// NOTE: Changed to just pull the lobby ID off of the user
			const lobbyToStart: Lobby | undefined = gameServer.getLobbyById(clientSocket.lobbyId);

			if (!!lobbyToStart) {
				// if (lobbyToJoin.addPlayer(clientSocket)) {
				//   const joinLobbySuccessMessage = new Message(EAction.JoinLobby, {
				//     success: true,
				//     lobbyId: lobbyToJoin.id,
				//   });
				//   clientSocket.socket.send(joinLobbySuccessMessage.toString());
				//   // Alert all clients the changes to the lobbies
				//   gameServer.connectedClients.forEach((el) =>
				//     ProtocolHelper.sendLobbyList(gameServer, el)
				//   );
				//   lobbyToJoin.players.forEach((el) => {
				//     ProtocolHelper.sendLobbyChanged(el, lobbyToJoin);
				//   });

				// TODO: Allow lobby to choose min players.
				const MIN_PLAYER_COUNT = 1;
				if (lobbyToStart.players.length >= MIN_PLAYER_COUNT && !lobbyToStart.isGameStarted) {
					const generateTurnCredentials = lobbyToStart.players.map((player_client: ClientSocket) => {
						return TurnHelper.generate(turnKey);
					});

					await Promise.all(generateTurnCredentials).then((turnResults) => {
						lobbyToStart.players.map((clientSocket, i) => {
							this.sendIceServers(clientSocket, turnResults[i]);
						});
					});

					setTimeout(() => {
						lobbyToStart.isGameStarted = true;
						lobbyToStart.players.forEach((player_client: ClientSocket) => {
							// Start
							ProtocolHelper.sendGameStarted(player_client, lobbyToStart);

							// Share all new sendNewPeerConnection
							var current_player_id: String = player_client.id;
							for (const next_player of lobbyToStart.players) {
								if (current_player_id !== next_player.id) {
									ProtocolHelper.sendNewPeerConnection(player_client, next_player.id);
								}
							}
						});
						// TODO: Remove lobby from list, disconnect all players.
						// TODO: Remove lobby from list, disconnect all players.
						// TODO: Remove lobby from list, disconnect all players. Not here, later...
					}, 1000);
				}
			} else {
				// const startGameFailureMessage = new Message(EAction.GameStarted, {
				// 	success: false,
				// });
				// clientSocket.socket.send(startGameFailureMessage.toString());
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.startGameForLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};

	// NEW:
	public static sendNewPeerConnection(clientSocket: ClientSocket, next_player_id: string) {
		try {
			const newPeerConnection: Message = new Message(EAction.NewPeerConnection, {
				id: next_player_id,
			});
			clientSocket.socket.send(newPeerConnection.toString());
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendnewPeerConnection()] An error had occurred while parsing a message: ${err}`);
		}
	}

	// NEW: TODO: should basically spread whatever info we give it... "meta" property for generic usage?
	public static playerUpdateInfo(gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) {
		try {
			const payload = message.payload;

			if (payload.leader !== undefined)
				clientSocket.leader = payload.leader;

			if (payload.team !== undefined)
				clientSocket.team = payload.team;

			if (clientSocket.lobbyId) {
				const lobby: Lobby = gameServer.getLobbyById(clientSocket.lobbyId);

				for (const nextPlayer of lobby.players) {
					ProtocolHelper.sendLobbyChanged(nextPlayer, lobby);
				}
			}
		}
		catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.playerUpdateInfo()] ${err}`);
		}
	}

	// NOTE: NEW!!! WILL IT WORK?
	// TODO: Prettier
	public static sendOfferAnswerOrCandidate(gameServer: GameServerHandler, _clientSocket: ClientSocket, message: Message) {
		try {
			const getClientForMessage: ClientSocket | undefined = gameServer.connectedClients.find((client) => client.id == message.payload.peer);

			// gameServer.connectedClients.map((client) => {
			// console.log('client.id', typeof message.payload.peer);
			// });
			// NOTE: passes along all of these tob be handled on the client using `message.action`!
			// case EAction.Offer:
			// case EAction.Answer:
			// case EAction.Candidate:

			// TODO: IF FAIL, DO NOT START.

			const newOfferAnswerOrCandidateMessage: Message = new Message(message.action, message.payload);
			getClientForMessage.socket.send(newOfferAnswerOrCandidateMessage.toString());
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendOfferAnswerOrCandidate()] An error had occurred while parsing a message: ${err}`);
		}
	}

	public static sendGameStarted(clientSocket: ClientSocket, lobbyToStart: Lobby) {
		try {
			const sendGameStartedMessage: Message = new Message(EAction.GameStarted, { lobby: lobbyToStart });
			clientSocket.socket.send(sendGameStartedMessage.toString());
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendGameStarted()] An error had occurred while parsing a message: ${err}`);
		}
	}

	public static sendIceServers(clientSocket: ClientSocket, turnResponse: TurnResponse) {
		try {
			const sendIceServers: Message = new Message(EAction.SetIceServers, { ...turnResponse });
			clientSocket.socket.send(sendIceServers.toString());
			return turnResponse;
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendIceServers()] An error had occurred while sending ice servers: ${err}`);
		}
	}

	/**
	 *
	 * @param clientSocket
	 * @param lobbyToJoin
	 */
	public static sendLobbyChanged(clientSocket: ClientSocket, lobbyToGet?: Lobby) {
		try {
			if (lobbyToGet) {
				const lobbyListMessage: Message = new Message(EAction.LobbyChanged, {
					lobby: lobbyToGet.get(),
				});
				clientSocket.socket.send(lobbyListMessage.toString());
			} else {
				const lobbyListEmpty: Message = new Message(EAction.LobbyChanged, {});
				clientSocket.socket.send(lobbyListEmpty.toString());
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendLobbyChanged()] An error had occurred while parsing a message: ${err}`);
		}
	}

	/**
	 *
	 * @param gameServer
	 * @param clientSocket
	 */
	private static processHeartbeat = (gameServer: GameServerHandler, clientSocket: ClientSocket) => {
		try {
			const heartBeatMessage: Message = new Message(EAction.Heartbeat, {});
			clientSocket.socket.send(heartBeatMessage.toString());
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.processHeartbeat()] An error had occurred while parsing a message: ${err}`);
		}
	};

	/**
	 *
	 * @param gameServer
	 * @param clientSocket
	 * @param message
	 */
	private static sendMessageToLobby = (gameServer: GameServerHandler, clientSocket: ClientSocket, message: Message) => {
		try {
			const lobby: Lobby = gameServer.getLobbyByPlayerId(clientSocket.id);
			if (!!lobby) {
				const lobbyMessage = new Message(EAction.MessageToLobby, { username: clientSocket.username, ...message.payload });
				lobby.players.forEach((el) => {
					// if (el !== clientSocket) {
					el.socket.send(lobbyMessage.toString());
					// }
				});
			}
		} catch (err: any) {
			LoggerHelper.logError(`[ProtocolHelper.sendMessageToLobby()] An error had occurred while parsing a message: ${err}`);
		}
	};
}
