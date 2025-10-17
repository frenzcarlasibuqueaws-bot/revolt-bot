import axios from "axios";
import { randomBytes } from "crypto";
import fs from "fs";
import express, { response } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { parse, stringify, toJSON, fromJSON } from "flatted";
import open from "open";
import { EventEmitter } from "events";
import { createInterface } from "readline";
import net from "net";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import argsParser from "args-parser";
import { generateSlug } from "random-word-slugs";

const bot_version = "revolt bot v4.26.2025.1128am-puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.platform == "win32") {
	process.title = bot_version;
} else {
	process.stdout.write("\x1b]2;" + bot_version + "\x1b\x5c");
}

const args = argsParser(process.argv);
var ports = {};

const rl = createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: true,
});

async function start_everything(IDENTIFIER_USER, IS_HEADLESS = true, START_IMMEDIATELY = true) {
	var claimStatus = true;
	const original_username = IDENTIFIER_USER;
	var ticketCount = 0;
	var is_running = false;

	emit_server_info();

	const eventEmitter = new EventEmitter();
	const Socket = net.Socket;
	
	puppeteer.use(StealthPlugin());

	var logs = [];
	// console.log(args);

	if (!IDENTIFIER_USER) {
		console.log({ type: "ErrorMessage", message: "--user argument is required" });
		return 1;
	}
	// else if (!isAlphanumeric(IDENTIFIER_USER)) {
	// 	console.log({ type: "DebugMessage", message: `--user only accepts alphanumeric strings: "${IDENTIFIER_USER}"` });
	// 	return 1;
	// }
	else {
		// IDENTIFIER_USER = `server-${IDENTIFIER_USER}`;
		console.log({ type: "DebugMessage", message: `Session for user "${IDENTIFIER_USER}" started` });
	}
	// process.exit();

	if (!fs.existsSync(`./${IDENTIFIER_USER}`)) {
		fs.mkdirSync(`./${IDENTIFIER_USER}`);
	}

	if (!fs.existsSync(`./${IDENTIFIER_USER}/browser-userdata`)) {
		fs.mkdirSync(`./${IDENTIFIER_USER}/browser-userdata`);
	}

	if (!START_IMMEDIATELY) {
		return 0;
	}

	var port = await getNextOpenPort(getRandomInt(49152, 49152));
	ports[IDENTIFIER_USER] = {
		user: IDENTIFIER_USER,
		port,
		is_running,
		is_headless: IS_HEADLESS,
	};
	emit_server_info();

	function isAlphanumeric(str) {
		return /^[a-zA-Z0-9]+$/.test(str);
	}

	process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;

	// Resolve the current directory

	const app = express();
	const server = createServer(app);
	const io = new Server(server);
	var browser = "";
	var global_page = "";

	var clientInfo = { servers: [], firstStart: true };
	var force_headful = false;

	app.use(express.static(path.join(__dirname, "public")));
	app.use(express.json());
	// CORS middleware
	app.use((req, res, next) => {
		res.setHeader("Access-Control-Allow-Origin", "*"); // Allow all origins

		// Handle preflight requests
		if (req.method === "OPTIONS") {
			return res.sendStatus(204); // No content
		}

		next(); // Proceed to the next middleware or route handler
	});

	const files = {
		responses: "responses.json",
		canReply: "canreply.json",
		responseDelay: "response_delay.json",
		isBotOn: "is_bot_on.json",
		alreadyResponded: "already_responded.txt",
		responseType: "response_type.json",
		instantResponses: "instant_responses.json",
	};

	const response_types = ["PREDEFINED", "PARSED_NUMBER"];
	const response_type_definition = {
		PREDEFINED: "Respond with set predefined response",
		PARSED_NUMBER: "Respond by parsing the number of the channel name",
	};

	// Initial values
	const initialValues = {
		responses: {},
		canReply: [],
		responseDelay: { min_ms: 1, max_ms: 1 }, // Example delay in milliseconds
		isBotOn: { status: true },
		alreadyResponded: "",
		responseType: {},
		instantResponses: {},
	};

	// Check for each file and create it if it doesn't exist
	for (const [key, file] of Object.entries(files)) {
		if (!fs.existsSync(`./${IDENTIFIER_USER}/${file}`)) {
			console.log(file);
			fs.writeFileSync(`./${IDENTIFIER_USER}/${file}`, JSON.stringify(initialValues[key], null, 2));
			addLog({ type: "DebugMessage", message: `Created ${file} with initial value` });
		} else {
			addLog({ type: "DebugMessage", message: `File ${file} exists` });
		}
	}

	var responses = JSON.parse(fs.readFileSync(`./${IDENTIFIER_USER}/responses.json`).toString());
	var canReply = JSON.parse(fs.readFileSync(`./${IDENTIFIER_USER}/canreply.json`).toString());
	var response_delay = JSON.parse(fs.readFileSync(`./${IDENTIFIER_USER}/response_delay.json`).toString());
	var isBotOn = JSON.parse(fs.readFileSync(`./${IDENTIFIER_USER}/is_bot_on.json`).toString());
	var responseType = JSON.parse(fs.readFileSync(`./${IDENTIFIER_USER}/response_type.json`).toString());
	var instantResponses = JSON.parse(fs.readFileSync(`./${IDENTIFIER_USER}/instant_responses.json`).toString());
	var token = "";
	var error = 0;

	var newChannels = [];

	eventEmitter.on("raw", async (msg) => {
		addLog(msg);
	});

	eventEmitter.on("Ready", (msg) => {
		const user = msg.users[msg.users.findIndex((user) => user.relationship == "User")];
		fs.writeFileSync(`./${IDENTIFIER_USER}/account_info.json`, JSON.stringify(user));
		clientInfo = msg;
		io.emit("bot_info", { username: user.username, id: user._id });
		io.emit("serverInfo", clientInfo);
		io.emit("canReply", canReply);
		io.emit("responses", responses);
		io.emit("response_delay", response_delay);
		io.emit("bot_status", isBotOn);
		io.emit("response_type", responseType);
		io.emit("bot_version", bot_version);
		io.emit("instant_responses", instantResponses);
		emit_server_info();
		console.log("Connected");
	});

	eventEmitter.on("Message", async (msg, page) => {
		console.log(clientInfo);

		var channel_index = clientInfo.channels.findIndex((obj) => obj._id == msg?.channel);
		var channel = channel_index != -1 ? clientInfo.channels[channel_index] : undefined;

		console.log({ channel_index, channel });

		if (channel.channel_type == "DirectMessage") {
			return addLog({ type: "DebugMessage", message: "Message is DirectMessage, skipping" });
		}

		var server_index = clientInfo.servers.findIndex((obj) => obj._id == channel?.server);
		var server = server_index != -1 ? clientInfo.servers[server_index] : undefined;

		console.log({ server_index, server });

		var category;
		if (server?.categories) {
			var category_index = server?.categories?.findIndex((obj) => obj.channels.includes(channel._id));
			category = category_index != -1 ? server?.categories[category_index] : undefined;
		}

		console.log({ category_index, category });

		var canReply = getCanReply(category ? category.id : null, channel?.name, server?._id);

		if (canReply.canReply) {
			var instantResponse = getInstantResponse(msg?.content, server._id, channel?.name);

			if (instantResponse.found) {
				ticketCount++;
				addLog({ type: "BotMessage", message: `✅ I can reply here. Reason: ${canReply.reason} & instant response match.` });
				if (instantResponse?.response && claimStatus) {
					if(server._id == '01JDKH82R0RHG2VF9YDWKEFHC5'){
						//addLog({ type: "BotMessage", message: `many` });
						//sendToDiscord("New ticket available!");
						var result = await sendMessage(msg?.channel, instantResponse?.response?.respondWith, page);
						var result = await sendMessage(msg?.channel, instantResponse?.response?.respondWith, page);
						var result = await sendMessage(msg?.channel, instantResponse?.response?.respondWith, page);
					} else  {
						//addLog({ type: "BotMessage", message: `one only` });
						//sendToDiscord("New ticket available!");
						var result = await sendMessage(msg?.channel, instantResponse?.response?.respondWith, page);
					}
					sendToDiscord(server.name, category.title, server._id,channel._id,channel.name);
					//addLog({ type: "DebugMessage", message: JSON.stringify(result) });
					//console.log(result);
				} else {
					addLog({ type: "DebugMessage", message: "Instant response gave no result; possible reason: no number on channel name to extract" });
				}
			}
		}
	});

	eventEmitter.on("ChannelCreate", async (msg, page) => {

		clientInfo.channels.push(msg);

		if (!isBotOn.status) {
			return addLog({ type: "DebugMessage", message: "Bot is currently set to OFF. Responses will not be sent." });
		}
		var _canReply = getCanReply(null, msg.name, msg.server);

		console.log(_canReply);
		if (_canReply.canReply) {
				var response = (getReplyWith(msg.server)) ? getReplyWith(msg.server) : "";

				var delay = getRandomInt(response_delay.min_ms, response_delay.max_ms);

				if (response) {
					addLog({ type: "BotMessage", message: `Waiting for ${delay / 1000} seconds to send response` });
					for (let i = 0; i < 4; i++) {
						setTimeout(async () => {
							try {
								if (responseType[msg.server] == "PARSED_NUMBER") {
									var response = extractNumbers(msg.name)[0];
								}

								if (response && claimStatus) {
									var result = await sendMessage(msg._id, `${response}`, page);
									//console.log(result.data);
									addLog({ type: "BotMessage", message: `Response successfully sent to "${msg.name}".` });
									//addLog({ type: "DebugMessage", message: JSON.stringify(result) });
								} else {
									addLog({ type: "BotMessage", message: `No number was extracted from "${msg.name}".` });
								}
							} catch (error) {
								console.log(error);
								addLog({ type: "BotMessage", message: `Something went wrong when sending repsonse. ID: ${msg._id} | Name: ${msg.name}` });
							}
						}, i * 30);
					}
				} else {
					addLog({ type: "BotMessage", message: `🤚 Set response is empty. I will not be replying. ID: ${msg._id} | Name: ${msg.name} | Reason: ${_canReply.reason}` });
				}
			} else {
				newChannels.push(msg);
				console.log(msg);
			}
	});

	eventEmitter.on("ServerUpdate", async (msg, page) => {
		if (!isBotOn.status) {
			addLog({ type: "DebugMessage", message: "Bot is currently set to OFF. Responses will not be sent." });
		}
		var serverIndex = -1;

		clientInfo.servers.forEach((server, index) => {
			if (server._id == msg.id) {
				if (msg?.data?.categories) {
					serverIndex = index;
					clientInfo.servers[index].categories = msg.data.categories;
				}
			}
		});

		console.log(msg.data.categories);

		var clonedChannels = JSON.parse(JSON.stringify(newChannels));

		console.log(clonedChannels);

		for (let i = 0; i < clonedChannels.length; i++) {
			const channel = clonedChannels[i];

			if (`${JSON.stringify(msg?.data?.categories)}`.includes(channel._id)) {
				newChannels.splice(i, 1);
				
				var found = findCategoryByChannelId(channel._id, msg.data.categories);
				console.log(found);
				
					var _canReply = getCanReply(found.id, channel.name, msg.id);

					if (_canReply.canReply) {
						addLog({ type: "BotMessage", message: `✅ I can reply here. server ID: ${channel.server} | channel ID: ${channel._id} | Name: ${channel.name} | Reason: ${_canReply.reason}` });
						//sendToDiscord(msg.id,channel._id,channel.name)
						var response = (getReplyWith(channel.server)) ? getReplyWith(channel.server) : "";

						if (response) {
							console.log(channel);

							var delay = getRandomInt(response_delay.min_ms, response_delay.max_ms);

							addLog({ type: "BotMessage", message: `Waiting for ${delay / 1000} seconds to send response` });

							setTimeout(async () => {
								try {
									if (responseType[channel.server] == "PARSED_NUMBER") {
										response = extractNumbers(channel.name)[0];
									}
									if (response && claimStatus) {
										var result = await sendMessage(channel._id, `${response}`, page);
										addLog({ type: "BotMessage", message: `Response successfully sent to "${channel.name}".` });
										//addLog({ type: "DebugMessage", message: JSON.stringify(result) });
									} else {
										addLog({ type: "BotMessage", message: `No number was extracted from "${msg.name}".` });
									}
								} catch (error) {
									console.log(error);
									addLog({ type: "BotMessage", message: `Something went wrong when sending repsonse. ID: ${channel._id} | Name: ${channel.name}` });
								}
							}, delay);
						} else {
							addLog({ type: "BotMessage", message: `🤚 Set response is empty. I will not be replying. ID: ${msg._id} | Name: ${msg.name} | Reason: ${_canReply.reason}` });
						}
					} else {
						io.emit("log", { timestamp: new Date().getTime(), log: { type: "BotMessage", message: `❌ I can't reply here. ID: ${channel._id} | Name: ${channel.name}` } });
					}
			}
		}

		io.emit("serverInfo", clientInfo);

		io.emit("canReply", canReply);
		io.emit("responses", responses);
		// var serverInfo = await getServerInfo(msg.server);
		// console.log(serverInfo);
		// console.log(JSON.stringify(serverInfo));

		// var counter = 0;

		// while (!JSON.stringify(serverInfo.categories).includes(msg._id) && counter < 10) {
		// 	serverInfo = await getServerInfo(msg.server);
		// 	console.log("Still no category...");
		// 	counter = counter + 1;
		// 	await sleep(500);
		// }

		// console.log("Category found! ");
		// console.log(serverInfo.categories);

		// var currentCategory = findCategoryByChannelId(msg._id, serverInfo.categories).id;

		// console.log(currentCategory);
		// if (getCanReply(currentCategory)) {
		// 	const response = (getReplyWith(msg.server)) ? getReplyWith(msg.server) : ".";
		// 	console.log(msg);
		// 	var result = await sendMessage(msg._id, response);
		// 	console.log(result.data);
		// }
	});

	eventEmitter.on("ServerCreate", (msg) => {
		if (!clientInfo.servers.some((server) => server._id == msg.id)) {
			clientInfo.servers.push(msg.server);
			clientInfo.channels = [...clientInfo.channels, ...msg.channels];
			clientInfo.emojis = [...clientInfo.emojis, ...msg.emojis];
			io.emit("serverInfo", clientInfo);
			io.emit("canReply", canReply);
			io.emit("responses", responses);
		}
	});

	eventEmitter.on("ServerMemberLeave", (msg) => {
		console.log(clientInfo.users[clientInfo?.users.findIndex((user) => user.relationship == "User")]._id);
		if (clientInfo.users[clientInfo?.users.findIndex((user) => user.relationship == "User")]._id == msg.user) {
			var indexToDelete = -1;
			var deletedServer = {};

			clientInfo.servers.forEach((server, index) => {
				if (server._id == msg.id) {
					indexToDelete = index;
					deletedServer = server;
				}
			});

			clientInfo.servers.splice(indexToDelete, 1);
			io.emit("serverInfo", clientInfo);
			io.emit("canReply", canReply);
			io.emit("responses", responses);
		}
	});

	eventEmitter.on("Debug", (msg) => {
		console.log(msg);
		// io.emit("bot_info", { username: client?.user?.username, id: client?.user?.id });
		// io.emit("serverInfo", clientInfo);
		//io.emit("log", { timestamp: new Date().getTime(), log: { type: "DebugMessage", message: msg } });
		addLog({ type: "DebugMessage", message: msg });
		if (msg.includes("Closed with reason:")) {
			
			("Closed on debug");

			error = error + 1;
			if (error >= 20) {
				error = 0;
				//io.emit("log", { timestamp: new Date().getTime(), log: { type: "FatalError", message: "Too much close just occured. Consider logging in again." } });
				return addLog({ type: "FatalError", message: "Too much close just occured. Consider logging in again." });
			}
			addLog({ type: "Info", message: "Will start again in 5 seconds." });
			//io.emit("log", { timestamp: new Date().getTime(), log: { type: "Info", message: "Will start again in 5 seconds." } });
			setTimeout(() => {
				start();
			}, 5000);
		}
	});

	eventEmitter.on("Error", (msg) => {
		console.log(msg);
		// io.emit("serverInfo", clientInfo);
		//io.emit("log", { timestamp: new Date().getTime(), log: { type: "ErrorMessage", message: msg } });
		addLog({ type: "ErrorMessage", message: msg });

		if (msg) {
			if (msg.includes("Closed with reason:")) {
				console.log("Closed on error");

				error = error + 1;
				if (error >= 20) {
					error = 0;
					//io.emit("log", { timestamp: new Date().getTime(), log: { type: "FatalError", message: "Too much close just occured. Consider logging in again." } });
					return addLog({ type: "FatalError", message: "Too much close just occured. Consider logging in again." });
				}
				addLog({ type: "Info", message: "Will start again in 5 seconds." });
				//io.emit("log", { timestamp: new Date().getTime(), log: { type: "Info", message: "Will start again in 5 seconds." } });
				setTimeout(() => {
					start();
				}, 5000);
			}
		}
	});

	async function start() {
		if (isBotOn.status) {
			try {
				// io.emit("serverInfo", clientInfo);
				addLog({ type: "DebugMessage", message: "Trying to open Puppeteer browser" });
				await initialize_puppeteer();
			} catch (error) {
				console.log(error.message);
				addLog({ type: "ErrorMessage", message: error.message });
			}
		} else {
			addLog({ type: "BotStatus", message: "Bot is currently set to OFF. No information will be sent from server to client." });
			addLog({ type: "BotStatus", message: 'Everything will say "loading".' });
		}
	}

	async function initialize_puppeteer() {
		// Initialize Puppeteer and create a new page
		browser = await puppeteer.launch({
			userDataDir: `./${IDENTIFIER_USER}/browser-userdata`,
			headless: force_headful ? false : IS_HEADLESS,
			args: ["--disable-blink-features=AutomationControlled"],
		});
		const page = await browser.newPage();
		page.goto("https://revolt.onech.at/");

		addLog({ type: "DebugMessage", message: "Puppeteer browser has launched. Bot dashboard panel will open once Revolt account is authenticated." });
		addLog({ type: "DebugMessage", message: `Puppeteer browser is currently running in ${(force_headful ? false : IS_HEADLESS) ? "Headless" : "Headful"} mode` });

		const client = await page.target().createCDPSession();

		await client.send("Network.enable");

		client.on("Network.webSocketCreated", ({ requestId, url }) => {
			// console.log("Network.webSocketCreated", requestId, url);
		});

		client.on("Network.webSocketClosed", ({ requestId, timestamp }) => {
			// console.log("Network.webSocketClosed", requestId, timestamp);
		});

		client.on("Network.webSocketFrameSent", async ({ requestId, timestamp, response }) => {
			// console.log("Network.webSocketFrameSent", requestId, timestamp, response.payloadData);
			if (is_valid_json(response.payloadData)) {
				var parsed = JSON.parse(response.payloadData);

				if (parsed.type == "Authenticate") {
					global_page = page;
					token = parsed.token;
					if (force_headful) {
						addLog({ type: "DebugMessage", message: "Successfully authenticated. Restarting Puppeteer in headless mode" });
						force_headful = false;

						setTimeout(async () => {
							await page.close();
							await browser.close();

							ports[IDENTIFIER_USER] = {
								user: IDENTIFIER_USER,
								port,
								is_running: false,
								is_headless: IS_HEADLESS,
							};
							emit_server_info();
							initialize_puppeteer();
						}, 1000);
					} else {
						addLog({ type: "DebugMessage", message: "Successfully authenticated." });
					}
				}
			}
		});

		client.on("Network.webSocketFrameReceived", async ({ requestId, timestamp, response }) => {
			// console.log(response.payloadData);

			if (is_valid_json(response.payloadData)) {
				var parsed = JSON.parse(response.payloadData);

				console.log(parsed);
				eventEmitter.emit(parsed.type, parsed, page);
			} else {
				console.log(response.payloadData);
			}
		});

		page.on("framenavigated", async (frame) => {
			if (frame.url().startsWith("https://revolt.onech.at/login") && !force_headful) {
				force_headful = true;
				addLog({ type: "DebugMessage", message: `Revolt redirected to "/login"` });
				addLog({ type: "DebugMessage", message: `Restarting Puppeteer browser in headful mode to show log in prompt` });

				// Retrieve all cookies
				const cookies = await page.cookies();

				// Delete all cookies
				for (const cookie of cookies) {
					await page.deleteCookie(cookie);
				}

				await page.goto("about:blank");

				setTimeout(async () => {
					await browser.close();

					await initialize_puppeteer();
				}, 1000);
			}
			if (((await page.content()).toLowerCase().includes("security of your connection") || (await page.content()).toLowerCase().includes("blocked")) && !force_headful) {
				addLog({ type: "DebugMessage", message: `Cloudflare detected. Restarting in headful mode` });
				force_headful = true;
				// Retrieve all cookies
				const cookies = await page.cookies();

				// Delete all cookies
				for (const cookie of cookies) {
					await page.deleteCookie(cookie);
				}

				await page.goto("about:blank");
				setTimeout(async () => {
					await browser.close();

					await initialize_puppeteer();
				}, 1000);
			}
		});

		if (force_headful) {
			return await page.evaluate(async (original_username) => {
				var html = `<div id="last_accessed" style="
                    pointer-events: none;
                    display: flex;
                    position: absolute;
                    top: 80px;
                    right: 10px;
                    z-index: 10000000;
                    background: #d5ff95;
                    border: 2px black dashed;
                    padding: 0.5rem 0.6rem;
                    border-radius: 1rem;
                    flex-direction: column;
                    color: black;
                    opacity: 0.7;
                    gap: 5px;
                "><div style="
                    display: flex;
                    flex-direction: column;
                    /* border-bottom: 5px; */
                ">
                <span>You are currently logging in for the server: "${original_username}"</span>
                <span style="margin-bottom: 1rem;">Data will be saved on the folder "${original_username}"</span>
                </nbsp>
                <span>Cloudflare problems? Clear cookies.</span>
                
                </div>`;

				var element = document.createElement("div");
				element.innerHTML = html;

				document.body.append(element);
			}, original_username);
		}

		setTimeout(() => {
			is_running = true;
			ports[IDENTIFIER_USER] = {
				user: IDENTIFIER_USER,
				port,
				is_running,
				is_headless: IS_HEADLESS,
			};
			emit_server_info();
		}, 10000);
	}

	start();
	
	async function sendToDiscord(server_name, category_title, server_id, channel_id, channel_name) {
		try {
			const res = await fetch("http://localhost:3000/revolt-to-discord", {
			  method: "POST",
			  headers: { "Content-Type": "application/json" },
			  body: JSON.stringify({ serverName: server_name, categoryTitle: category_title, serverId: server_id, channelId: channel_id, channelName: channel_name })
			});

			if (!res.ok) {
			  console.error(`❌ Failed to send to Discord: ${res.status} ${res.statusText}`);
			} else {
			  console.log("✅ Successfully sent to Discord bridge");
			}
		  } catch (err) {
			// ECONNREFUSED will land here
			console.error("⚠️ Could not reach Discord bridge:", err.message);
		  }
	}
	
	async function addInstantResponse(serverId = "", message = "", respondWith = "", regex = false, caseSensitive = false, uuid = "") {
		if (!instantResponses[serverId]) {
			instantResponses[serverId] = {};
		}

		instantResponses[serverId][uuid] = {
			respondWith,
			regex: JSON.parse(regex),
			caseSensitive: JSON.parse(caseSensitive),
			message,
			uuid,
		};

		clientInfo.instantResponses = instantResponses;
		console.log(instantResponses);

		fs.writeFileSync(`./${IDENTIFIER_USER}/instant_responses.json`, JSON.stringify(instantResponses));
	}

	async function removeInstantResponse(serverId = "", uuid = "") {
		if (!instantResponses[serverId]) {
			instantResponses[serverId] = {};
		}
		if (instantResponses[serverId][uuid]) {
			delete instantResponses[serverId][uuid];
		} else {
			throw new Error("NON_EXISTENT_INSTANT_RESPONSE");
		}
		clientInfo.instantResponses = instantResponses;
		console.log(instantResponses);

		fs.writeFileSync(`./${IDENTIFIER_USER}/instant_responses.json`, JSON.stringify(instantResponses));
	}

	async function setReplyWith(string, serverId) {
		responses[serverId] = string;
		console.log({ serverId, string });
		clientInfo.responses = responses;
		clientInfo.canReply = canReply;
		console.log(responses);
		fs.writeFileSync(`./${IDENTIFIER_USER}/responses.json`, JSON.stringify(responses));
	}

	function getReplyWith(serverId) {
		return responses[serverId];
	}

	async function addReplyWithKeyword(string, serverId) {
		if (string) {
			string = string.trim();
		}
		if (!responses[serverId + "_keywords"]) {
			responses[serverId + "_keywords"] = [];
		}

		if (responses[serverId + "_keywords_is_case_sensitive"] != true && responses[serverId + "_keywords_is_case_sensitive"] != false) {
			responses[serverId + "_keywords_is_case_sensitive"] = false;
		}

		if (responses[serverId + "_keywords"].includes(string)) {
			throw new Error("DUPLICATE_KEYWORD");
		}

		responses[serverId + "_keywords"].push(string);

		// responses[serverId] = string;
		// console.log({ serverId, string });
		responses[serverId + "_keywords"] = [...new Set(responses[serverId + "_keywords"])];
		clientInfo.responses = responses;
		clientInfo.canReply = canReply;
		console.log(responses);
		fs.writeFileSync(`./${IDENTIFIER_USER}/responses.json`, JSON.stringify(responses));
		return true;
	}

	async function removeKeyword(string, serverId) {
		if (!responses[serverId + "_keywords"]) {
			responses[serverId + "_keywords"] = [];
		}

		if (responses[serverId + "_keywords_is_case_sensitive"] != true && responses[serverId + "_keywords_is_case_sensitive"] != false) {
			responses[serverId + "_keywords_is_case_sensitive"] = false;
		}

		var index = responses[serverId + "_keywords"].indexOf(string);

		if (index !== -1) {
			responses[serverId + "_keywords"].splice(index, 1);
			fs.writeFileSync(`./${IDENTIFIER_USER}/responses.json`, JSON.stringify(responses));
			return true;
		} else {
			throw new Error("NON_EXISTENT_KEYWORD");
		}
	}

	async function setKeywordCaseSensitive(state, serverId) {
		responses[serverId + "_keywords_is_case_sensitive"] = state;

		clientInfo.responses = responses;
		clientInfo.canReply = canReply;
		console.log(responses);
		fs.writeFileSync(`./${IDENTIFIER_USER}/responses.json`, JSON.stringify(responses));
	}

	async function setCanReply(categoryId) {
		canReply.push(categoryId);

		clientInfo.responses = responses;
		clientInfo.canReply = canReply;

		fs.writeFileSync(`./${IDENTIFIER_USER}/canreply.json`, JSON.stringify([...new Set(canReply)]));
	}

	async function unsetCanReply(categoryId) {
		// Remove the value using filter
		canReply = canReply.filter((item) => item !== categoryId);

		fs.writeFileSync(`./${IDENTIFIER_USER}/canreply.json`, JSON.stringify(canReply));
	}

	function getInstantResponse(message, serverId, channelName) {
		console.log({ message, serverId, channelName });

		if (message && channelName) {
			for (let index = 0; index < Object.values(instantResponses[serverId] ? instantResponses[serverId] : {}).length; index++) {
				const response = Object.values(instantResponses[serverId] ? instantResponses[serverId] : {})[index];

				if (response.caseSensitive) {
					message = message.toLowerCase();
					channelName = channelName.toLowerCase();
				}

				if (message.includes(response.message)) {
					if (response.regex) {
						return {
							found: true,
							response: { respondWith: extractNumbers(channelName)[0] },
						};
					}
					return {
						found: true,
						response,
					};
				}
			}
		} else {
			addLog({ type: "DebugMessage", message: `${message ? "" : "message, "} ${channelName ? "" : "channelName"} input is empty` });
		}

		return { found: false };
	}

	function getCanReply(categoryId, channelName, serverId) {
		if (responses[`${serverId}_keywords`]) {
			console.log(`${serverId}_keywords`);
			for (let index = 0; index < responses[`${serverId}_keywords`].length; index++) {
				const keyword = responses[`${serverId}_keywords`][index];

				if (`${serverId}_keywords_is_case_sensitive`) {
					if (channelName.toLowerCase().includes(keyword.toLowerCase())) {
						return {
							canReply: true,
							reason: "keyword match on channel",
						};
					}
				} else {
					if (channelName.includes(keyword)) {
						return {
							canReply: true,
							reason: "keyword match on channel",
						};
					}
				}
			}
		}

		return {
			canReply: canReply.includes(categoryId),
			reason: canReply.includes(categoryId) ? "category match" : "",
		};
	}

	async function joinServer(link, page) {
		link = ensureHttps(link);
		if (!isValidInviteLink(link)) {
			return { error: true };
		}

		link = link.replace("/invite/", "/invites/");
		link = link.replace("revolt.onech.at", "revolt-api.onech.at");

		return await page.evaluate(
			async (token, link) => {
				var result = await fetch(link, {
					method: "POST",
					headers: {
						"X-Session-Token": token,
						referer: "https://revolt.onech.at/",
					},
				});

				var data = await result.json();
				return data;
			},
			token,
			link
		);
	}

	function isValidInviteLink(link) {
		const regex = /^https?:\/\/revolt\.onech\.at\/invite\/[A-Za-z0-9]{8}$/;
		return regex.test(link);
	}

	async function setBotStatus(status) {
		if (status == true || status == false) {
			isBotOn.status = status;
			fs.writeFileSync(`./${IDENTIFIER_USER}/is_bot_on.json`, JSON.stringify(isBotOn));

			if (!status) {
				await browser.close();
				addLog({ type: "DebugMessage", message: `Puppeteer browser has been closed` });
			} else {
				initialize_puppeteer();
			}

			io.emit("bot_status", isBotOn);
			return true;
		} else {
			throw new Error("INPUT_NOT_BOOLEAN");
		}
	}

	function ensureHttps(url) {
		// Check if the URL starts with 'https://'
		if (url.startsWith("https://")) {
			return url; // Return as is
		}
		// Check if it starts with 'http://'
		else if (url.startsWith("http://")) {
			return url.replace("http://", "https://"); // Replace with 'https://'
		}
		// If it doesn't start with either, add 'https://'
		else {
			return "https://" + url;
		}
	}

	// async function sendMessage(id, message) {
	// 	if (!isBotOn.status) {
	// 		addLog({ type: "DebugMessage", message: "Bot is currently set to OFF. Responses will not be" });
	// 	}

	// 	const result = await axios({
	// 		url: `https://revolt-api.onech.at/channels/${id}/messages`,
	// 		data: { content: message, nonce: generateNonce(26), replies: [] },
	// 		headers: {
	// 			// "X-Bot-Token": zapbox_token,
	// 			"X-Session-Token": bot_token,
	// 		},
	// 		method: "POST",
	// 	});

	// 	return result;
	// }

	// async function getServerInfo(serverId) {
	// 	const result = await axios({
	// 		url: `https://revolt-api.onech.at/servers/${serverId}`,
	// 		//   https://revolt-api.onech.at/servers/01JJAAA2TW3WJ6KCYRDJ7ZM03R
	// 		headers: {
	// 			// "X-Bot-Token": zapbox_token,
	// 			"X-Session-Token": bot_token,
	// 			accept: "application/json, text/plain, */*",
	// 		},
	// 		method: "GET",
	// 	});

	// 	return result.data;
	// }

	async function leaveServer(serverId, leaveSilently, page) {
		return await page.evaluate(
			async (token, serverId, leaveSilently) => {
				var result = await fetch(`https://revolt-api.onech.at/servers/${serverId}/${leaveSilently ? "?leave_silently=true" : "?leave_silently=false"}`, {
					method: "DELETE",
					headers: {
						"X-Session-Token": token,
						referer: "https://revolt.onech.at/",
					},
				});

				return { success: true };
			},
			token,
			serverId,
			leaveSilently
		);
	}

	function isValidRegex(pattern) {
		try {
			new RegExp(pattern);
			return true; // The pattern is valid
		} catch (e) {
			return false; // The pattern is invalid
		}
	}

	function findCategoryByChannelId(channelId, categories = []) {
		for (const category of categories) {
			if (category.channels.includes(channelId)) {
				return category; // Return the category title if found
			}
		}
		return null; // Return null if the channel ID is not found
	}

	function generate_nonce(length) {
		return randomBytes(length).toString("base64").replace(/\+/g, "0").replace(/\//g, "1").substring(0, length).toUpperCase();
	}

	async function setResponseDelay(min, max) {
		if (!isOnlyNumbers(max) || !isOnlyNumbers(min)) {
			throw new Error("INPUT_NOT_NUMERICAL");
		}

		response_delay = {
			min_ms: min,
			max_ms: max,
		};

		fs.writeFileSync(`./${IDENTIFIER_USER}/response_delay.json`, JSON.stringify(response_delay));

		return true;
	}

	async function setResponseType(type, server_id) {
		if (!response_types.includes(type)) {
			throw new Error("INVALID_RESPONSE_TYPE");
		}

		responseType[server_id] = type;

		fs.writeFileSync(`./${IDENTIFIER_USER}/response_type.json`, JSON.stringify(responseType));
		return true;
	}

	function isOnlyNumbers(input) {
		return /^\d+$/.test(input);
	}

	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function addLog(log) {
		console.log(log);
		var _log = { timestamp: new Date().getTime(), log, uuid: uuidv4() };
		logs.unshift(_log);
		io.emit("log", _log);

		if (logs.length > 20) {
			logs.pop(); // Remove the oldest log
		}

		// if (logs.length > 20) {
		// 	logs = logs.slice(20);
		// }
	}

	async function log_in(email, password) {
		const response = await axios({
			url: "https://revolt-api.onech.at/auth/session/login",
			data: {
				email,
				password,
				friendly_name: "edge-chromium on Windows 10",
			},
			headers: {
				"accept-encoding": "gzip, deflate, br, zstd",
				"accept-language": "fil",
				"cache-control": "no-cache",
				origin: "https://revolt.onech.at",
				pragma: "no-cache",
				priority: "u=1, i",
				referer: "https://revolt.onech.at/",
				"sec-ch-ua": '"Chromium";v="134", "Not:A-Brand";v="24", "Microsoft Edge";v="134"',
				"sec-ch-ua-mobile": "?0",
				"sec-ch-ua-platform": '"Windows"',
				"sec-fetch-dest": "empty",
				"sec-fetch-mode": "cors",
				"sec-fetch-site": "same-site",
				"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0",
			},
		});

		return response.data;
	}

	function extractNumbers(str) {
		// Use a regular expression to match all numbers in the string
		const numbers = str.match(/\d+/g);

		// If no numbers are found, return an empty array
		return numbers ? numbers : [];
	}

	function is_valid_json(string) {
		try {
			JSON.parse(string);
			return true;
		} catch (e) {
			return false;
		}
	}

	async function sendMessage(id, content, page) {
		console.log({ id, content, page });
		try {
			await page.exposeFunction("generate_nonce", generate_nonce);
		} catch (error) {}

		return await page.evaluate(
			async (id, content, token) => {
				var result = await fetch(`https://revolt-api.onech.at/channels/${id}/messages`, {
					method: "POST",
					headers: {
						"X-Session-Token": token,
						"idempotency-key": await `01${await generate_nonce(24)}`,
					},
					body: JSON.stringify({
						content: content,
						nonce: `01${await generate_nonce(24)}`,
						replies: [],
					}),
				});

				// var data = await result.text();
				// return data;
			},
			id,
			content,
			token
		);
	}

	function formatTimestampWithAMPM(timestamp = new Date().getTime()) {
		const date = new Date(timestamp);
		let hours = date.getHours();
		const minutes = date.getMinutes();
		const seconds = date.getSeconds();

		// Determine AM or PM suffix
		const ampm = hours >= 12 ? "PM" : "AM";

		// Convert to 12-hour format
		hours = hours % 12;
		hours = hours ? hours : 12; // the hour '0' should be '12'

		// Format minutes and seconds to be two digits
		const formattedMinutes = minutes < 10 ? "0" + minutes : minutes;
		const formattedSeconds = seconds < 10 ? "0" + seconds : seconds;

		return `${hours}:${formattedMinutes}:${formattedSeconds} ${ampm}`;
	}

	io.on("connection", (socket) => {
		if (clientInfo.users) {
			io.emit("bot_info", { username: clientInfo.users[clientInfo?.users.findIndex((user) => user.relationship == "User")].username, id: clientInfo.users[clientInfo?.users.findIndex((user) => user.relationship == "User")]._id });
		}

		io.emit("bot_version", bot_version);
		io.emit("serverInfo", clientInfo);
		io.emit("canReply", canReply);
		io.emit("responses", responses);
		io.emit("response_delay", response_delay);
		io.emit("bot_status", isBotOn);
		io.emit("response_type", responseType);
		io.emit("instant_responses", instantResponses);
	});

	app.get("/api/servers", (req, res) => {
		// console.log(client.);
		clientInfo.canReply = canReply;
		clientInfo.responses = responses;
		// clientInfo.logs = logs;
		res.json(clientInfo);
	});

	app.post("/api/set_response", async (req, res) => {
		if (!req.query.response) {
			await setReplyWith(req.query.response, req.query.serverId);
			addLog({ type: "DebugMessage", message: `Bot response set to empty on server "${req.query.serverId}"` });

			return res.json({ ...responses, error: false });
		}
		if (!req.query.serverId) {
			return res.status(400).json({ error: true, message: "Server ID is empty" });
		}

		await setReplyWith(req.query.response, req.query.serverId);

		addLog({ type: "DebugMessage", message: `Bot will now respond "${req.query.response}" on server "${req.query.serverId}"` });

		res.json({ ...responses, error: false });
	});

	app.post("/api/set_response_keyword_case_sensitive", async (req, res) => {
		if (!req.query.state) {
			return res.status(400).json({ error: true, message: "State is empty" });
		}
		if (!req.query.state != true && !req.query.state != false) {
			return res.status(400).json({ error: true, message: "State is not a boolean" });
		}
		if (!req.query.serverId) {
			return res.status(400).json({ error: true, message: "Server ID is empty" });
		}

		await setKeywordCaseSensitive(req.query.state, req.query.serverId);

		addLog({ type: "DebugMessage", message: `Keyword responding is now ${req.query.state ? "case sensitive" : "case insensitive"} on "${req.query.serverId}"` });

		res.json({ ...responses, error: false });
	});

	app.post("/api/add_response_keyword", async (req, res) => {
		if (!req.query.string) {
			return res.status(400).json({ error: true, message: "String is empty" });
		}
		if (!req.query.serverId) {
			return res.status(400).json({ error: true, message: "Server ID is empty" });
		}

		try {
			var result = await addReplyWithKeyword(req.query.string, req.query.serverId);

			addLog({ type: "DebugMessage", message: `Bot will now respond to categories on server "${req.query.serverId}" with the keyword ${req.query.string}` });

			io.emit("responses", responses);
			res.json({ ...responses, error: false });
		} catch (error) {
			console.log(error);
			if (error.message == "DUPLICATE_KEYWORD") {
				return res.status(400).json({
					error: true,
					reason: "DUPLICATE_KEYWORD",
				});
			}
			res.status(500).json(error);
		}
	});

	app.post("/api/delete_keyword", async (req, res) => {
		if (!req.query.string) {
			return res.status(400).json({ error: true, message: "String is empty" });
		}
		if (!req.query.serverId) {
			return res.status(400).json({ error: true, message: "Server ID is empty" });
		}

		try {
			var result = await removeKeyword(req.query.string, req.query.serverId);

			addLog({ type: "DebugMessage", message: `Keyword "${req.query.string}" for matching has been removed on server ${req.query.serverId}` });

			io.emit("responses", responses);
			res.json({ ...responses, error: false });
		} catch (error) {
			console.log(error.message);
			if (error.message == "NON_EXISTENT_KEYWORD") {
				return res.status(400).json({
					error: true,
					reason: "NON_EXISTENT_KEYWORD",
				});
			}
			res.status(500).json(error);
		}
	});

	app.post("/api/set_can_reply", async (req, res) => {
		if (!req.query.categoryId) {
			return res.status(400).json({ error: true, message: "Category ID is empty" });
		}

		addLog({ type: "DebugMessage", message: `Bot will now respond on category "${req.query.categoryId}"` });

		await setCanReply(req.query.categoryId);
		res.json({ canReply, error: false });
	});

	app.post("/api/join_server", async (req, res) => {
		if (!req.query.serverUrl) {
			return res.status(400).json({ error: true, message: "Server URL is empty" });
		}
		try {
			const result = await joinServer(req.query.serverUrl, global_page);

			if (!clientInfo.servers.some((server) => server._id == result.server._id)) {
				clientInfo.servers.push(result.server);
				clientInfo.channels = [...clientInfo.channels, ...result.channels];
				// clientInfo.emojis = [...clientInfo.emojis, ...result.emojis];
			}

			if (result.error) {
				res.status(400).json({ error: true, message: `Something went wrong in joining the server link.`, response: result.response });
			} else {
				console.log(result.server._id);

				console.log(result);

				addLog({ type: "DebugMessage", message: `Bot has joined the server with the invite link "${req.query.serverUrl}"` });
				res.json({ ...result, clientInfo });
			}
		} catch (error) {
			console.log(error);
			res.status(500).json({ error: true, message: `Something went wrong in joining the server link.`, response: error });
		} finally {
			io.emit("serverInfo", clientInfo);
			io.emit("canReply", canReply);
			io.emit("responses", responses);
		}
	});

	app.post("/api/leave_server", async (req, res) => {
		if (!req.query.serverId) {
			return res.status(400).json({ error: true, message: "Server ID is empty" });
		}
		try {
			const result = await leaveServer(req.query.serverId, req.query.leaveSilently, global_page);

			if (result.error) {
				res.status(400).json({ error: true, message: `Something went wrong in leaving server.` });
			} else {
				addLog({ type: "DebugMessage", message: `Bot has left the server "${req.query.serverId}"` });
				res.json({ ...result, clientInfo });
			}
		} catch (error) {
			console.log(error);
			res.status(500).json({ error: true, message: `Something went wrong in leaving server.` });
		} finally {
			io.emit("serverInfo", clientInfo);
			io.emit("canReply", canReply);
			io.emit("responses", responses);
		}
	});

	app.get("/api/logs", async (req, res) => {
		res.json(logs);
	});

	// app.post("/api/login", async (req, res) => {
	// 	io.emit("bot_info", { username: undefined, id: undefined, loading: true });
	// 	try {
	// 		const response = await log_in(req.query.email, req.query.password);
	// 		res.json(response);
	// 		clientInfo = { servers: [], firstStart: true };
	// 		io.emit("serverInfo", clientInfo);
	// 		io.emit("canReply", canReply);
	// 		io.emit("responses", responses);
	// 		fs.writeFileSync("credentials.json", JSON.stringify(response));
	// 		bot_token = response.token;
	// 		client.destroy();
	// 		start();
	// 	} catch (error) {
	// 		console.log(error);
	// 		if (error.status == 401) {
	// 			console.log(error);
	// 		}
	// 		addLog({ type: "ErrorMessage", message: "Something went wrong when logging in. Please check your login details." });
	// 		res.json({ error: true, message: "Something went wrong when logging in. Please check your login details." }).status(error.status);
	// 	}
	// });

	app.delete("/api/set_can_reply", async (req, res) => {
		if (!req.query.categoryId) {
			return res.status(400).json({ error: true, message: "Category ID is empty" });
		}

		addLog({ type: "DebugMessage", message: `Bot will now stop responding on category "${req.query.categoryId}"` });

		await unsetCanReply(req.query.categoryId);
		res.json({ canReply, error: false });
	});

	app.post("/api/set_bot_status", async (req, res) => {
		try {
			if (!req.query.status) {
				return res.status(400).json({ error: true, message: "Status is empty" });
			}

			var result = await setBotStatus(JSON.parse(req.query.status));

			addLog({ type: "BotStatus", message: isBotOn.status ? "Bot is now set to: ON" : "Bot is now set to: OFF" });
			res.json({ error: false, message: `Bot is now turned ${isBotOn.status ? "ON" : "OFF"}` }).status(error.status);
		} catch (error) {
			console.log(error);
			addLog({ type: "BotStatus", message: "Something went wrong when setting bot status." });
			res.json({ error: true, message: "Something went wrong when setting bot status." }).status(500);
		}
	});

	app.post("/api/set_response_delay", async (req, res) => {
		try {
			if (!req.query.min) {
				return res.status(400).json({ error: true, message: "Minimum is empty" });
			}
			if (!req.query.max) {
				return res.status(400).json({ error: true, message: "Maximum is empty" });
			}

			var result = await setResponseDelay(req.query.min, req.query.max);
			addLog({ type: "DebugMessage", message: `Response delay successfully set, bot will now pick a random number from ${req.query.min} to ${req.query.max} as millisecond value delay` });
			res.json({ error: false, message: "Successfully set response delay." });
			io.emit("response_delay", response_delay);
		} catch (error) {
			res.status(500).json({ error: true, message: "Something went wrong when setting response delay." });
		}
	});

	app.post("/api/set_response_type", async (req, res) => {
		try {
			if (!response_types.includes(req.query.response_type)) {
				return res.status(400).json({ error: true, message: `Response type "${req.query.response_type}" is not valid.` });
			}

			if (!req.query.serverId) {
				return res.status(400).json({ error: true, message: "Server ID is empty" });
			}

			var result = await setResponseType(req.query.response_type, req.query.serverId);
			addLog({ type: "DebugMessage", message: `Response type successfully set to ${req.query.response_type}: ${response_type_definition[req.query.response_type]} in server ${req.query.serverId}` });
			res.json({ error: false, message: "Successfully set response type." });
			io.emit("response_type", responseType);
		} catch (error) {
			console.log(error);
			res.status(500).json({ error: true, message: "Something went wrong when setting response type." });
		}
	});

	app.post("/api/instant_response", async (req, res) => {
		try {
			const { serverId, message, respondWith, regex, caseSensitive, uuid } = req.query;

			// Check for serverId
			if (!serverId) {
				return res.status(400).json({ error: true, message: "Server ID is empty" });
			}

			// Check for uuid
			if (!uuid) {
				return res.status(400).json({ error: true, message: "UUID is empty" });
			}

			// Check for message
			if (!message) {
				return res.status(400).json({ error: true, message: "Message is empty" });
			}

			// Check for respondWith
			if (!respondWith && !regex) {
				return res.status(400).json({ error: true, message: "Response is empty" });
			}

			// Check for regex (if applicable)
			if (!regex) {
				return res.status(400).json({ error: true, message: "Response type is empty" });
			}

			// Check for caseSensitive
			if (caseSensitive && !["true", "false"].includes(caseSensitive)) {
				return res.status(400).json({ error: true, message: "caseSensitive must be 'true' or 'false'" });
			}

			var result = await addInstantResponse(serverId, message, respondWith, regex, caseSensitive, uuid);

			addLog({ type: "DebugMessage", message: `Instant response added in server ${serverId}` });
			res.json({ error: false, message: "Successfully added instant response." });
			io.emit("instant_responses", clientInfo.instantResponses);
		} catch (error) {
			res.json({ error: true, message: "Something went wrong when adding instant response." });
		}
	});
	
	app.post("/discord-to-revolt", (req, res) => {
	  const { claiming } = req.body; // values sent from Discord
	  if (claiming == 'claimYes') {
		  claimStatus = true;
	  } else if (claiming == 'claimNo') {
		  claimStatus = false;
	  }
	});

	app.delete("/api/instant_response", async (req, res) => {
		try {
			const { serverId, uuid } = req.query;

			// Check for serverId
			if (!serverId) {
				return res.status(400).json({ error: true, message: "Server ID is empty" });
			}

			// Check for uuid
			if (!uuid) {
				return res.status(400).json({ error: true, message: "UUID is empty" });
			}

			var result = await removeInstantResponse(serverId, uuid);

			addLog({ type: "DebugMessage", message: `Instant response deleted in server ${serverId}` });
			res.json({ error: false, message: "Successfully deleted instant response." });
			io.emit("instant_responses", clientInfo.instantResponses);
		} catch (error) {
			console.log(error);
			res.json({ error: true, message: "Something went wrong when deleting instant response." });
		}
	});

	app.get("/api/bot_version", (req, res) => {
		res.end(bot_version);
	});

	app.get("/api/end_server", async (req, res) => {
		if (!is_running) {
			return res.json({ error: true });
		}
		await browser.close();
		res.json({ error: false });
		await io.disconnectSockets();
		await io.close();
		await server.close();
		delete ports[original_username];
		emit_server_info();
	});

	try {
		addLog({ type: "DebugMessage", message: "Trying to start bot dashboard server" });

		server.listen(port, () => {
			console.log(`Now listening to: http://localhost:${port}`);
			open(`http://localhost:${port}`);
			addLog({ type: "DebugMessage", message: `Now listening to: http://localhost:${port}` });
		});
	} catch (error) {
		if (error.code == "ERR_SERVER_ALREADY_LISTEN") {
			addLog({ type: "DebugMessage", message: "Bot dashboard server already running" });
		}
		if (error.code == "EADDRINUSE") {
			port = getRandomInt(49152, 50000);
		}

		console.log(error);
	}

	// Handle termination signals

	// rl.input.on("keypress", async (char, key) => {
	// 	if (key.name === "c" && key.ctrl) {
	// 		addLog({ type: "DebugMessage", message: `CTRL + C was pressed. Exiting now.` });
	// 		fs.rmSync(`./${IDENTIFIER_USER}/port`);
	// 		rl.close();
	// 		await browser.close();
	// 		process.exit(0);
	// 	}

	// 	if (key.name === "u") {
	// 		console.log(`--------------------------`);
	// 		console.log(`http://localhost:${port}`);
	// 		console.log(`--------------------------`);
	// 	}
	// });
}

function getRandomInt(min, max) {
	min = parseInt(min);
	max = parseInt(max);
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isPortOpen(port) {
	return new Promise((resolve, reject) => {
		let s = net.createServer();
		s.once("error", (err) => {
			s.close();
			if (err["code"] == "EADDRINUSE") {
				resolve(false);
			} else {
				resolve(false); // or throw error!!
				// reject(err);
			}
		});
		s.once("listening", () => {
			resolve(true);
			s.close();
		});
		s.listen(port);
	});
}

async function getNextOpenPort(startFrom = 2222) {
	let openPort = null;
	while (startFrom < 65535 || !!openPort) {
		if (await isPortOpen(startFrom)) {
			openPort = startFrom;
			break;
		}
		startFrom++;
	}
	return openPort;
}

var port = await getNextOpenPort(1024);

const global_app = express();
const global_server = createServer(global_app);
const global_io = new Server(global_server);

global_io.on("connection", () => {
	global_io.emit("bot_version", bot_version);
	emit_server_info();
});

global_app.use(express.static(path.join(__dirname, "public/multi")));

global_app.post("/api/server", async (req, res) => {
	if (!req.query.server) {
		return res.end("Server is required");
	}

	if (ports[req.query.server]) {
		return res.end("User has already started");
	}

	await start_everything(req.query.server, req.query.headless);

	emit_server_info();
	res.end("Starting.");
});

global_app.delete("/api/server", async (req, res) => {
	if (!req.query.server) {
		return res.end("Server is required");
	}

	try {
		fs.rmSync(req.query.server, { recursive: true });
		emit_server_info();
		res.status(200).end(req.query.server);
		return 0;
		// if (ports[req.query.server]?.port) {
		// 	await axios(`http://127.0.0.1:${ports[req.query.server]?.port}/api/end_server`);
		// 	waitUntil(ports[req.query.server]?.port);
		// } else {
		// 	fs.rmSync(req.query.server, { recursive: true });
		// 	emit_server_info();
		// 	res.status(200);
		// }

		// function waitUntil(condition) {
		// 	if (condition) {
		// 		setTimeout(() => {
		// 			waitUntil(condition);
		// 		}, 1000);
		// 	} else {
		// 		fs.rmSync(req.query.server, { recursive: true });
		// 		emit_server_info();
		// 		res.status(200).end(req.query.server);
		// 		return 0;
		// 	}
		// }
	} catch (error) {
		console.log(error);
		res.status(500).end(error.code);
	}
});

global_app.get("/api/running-servers", async (req, res) => {
	res.json(ports);
});

global_app.get("/api/servers", async (req, res) => {
	var users = fs.readdirSync("./").filter((folder) => folder.startsWith("server-"));

	var user_infos = users.map((user) => {
		if (fs.existsSync(`${user}/account_info.json`)) {
			return {
				...JSON.parse(fs.readFileSync(`${user}/account_info.json`)),
				folder: user,
				port: ports[user]?.port || null,
				is_running: ports[user]?.is_running || false,
				is_headless: ports[user]?.is_headless || false,
			};
		} else {
			return {
				folder: user,
				port: ports[user]?.port || null,
				is_running: ports[user]?.is_running || false,
				is_headless: ports[user]?.is_headless || false,
			};
		}
	});

	res.json(user_infos);
});

global_app.post("/api/add_server", async (req, res) => {
	const slug = "server-" + generateSlug();
	res.end(slug);
	await start_everything(slug, true, false);

	emit_server_info();
});

global_server.listen(port, () => {
	console.log(`Now listening to: http://localhost:${port}`);
	open(`http://localhost:${port}`);

	emit_server_info();
});

rl.input.on("keypress", async (char, key) => {
	if (key.name === "c" && key.ctrl) {
		console.log({ type: "DebugMessage", message: `CTRL + C was pressed. Exiting now.` });
		rl.close();
		process.exit(0);
	}

	if (key.name === "u") {
		console.log(`--------------------------`);
		console.log(`http://localhost:${port}`);
		console.log(`--------------------------`);
	}
});

function removeStartSubstring(str, substr) {
	if (str.startsWith(substr)) {
		return str.slice(substr.length);
	}
	return str; // Return original string if it doesn't start with the substring
}

function emit_server_info() {
	var users = fs.readdirSync("./").filter((folder) => folder.startsWith("server-"));

	var user_infos = users.map((user) => {
		if (fs.existsSync(`${user}/account_info.json`)) {
			return {
				...JSON.parse(fs.readFileSync(`${user}/account_info.json`)),
				folder: user,
				port: ports[user]?.port || null,
				is_running: ports[user]?.is_running || false,
				is_headless: ports[user]?.is_headless || false,
			};
		} else {
			return {
				folder: user,
				port: ports[user]?.port || null,
				is_running: ports[user]?.is_running || false,
				is_headless: ports[user]?.is_headless || false,
			};
		}
	});

	global_io.emit("servers", user_infos);
}
