const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

    let filePath = req.url.split("?")[0];

    if (filePath === "/") {
        filePath = "/index.html";
    }

    const fullPath = path.join(__dirname, filePath);

    if (!fs.existsSync(fullPath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
    }

    const ext = path.extname(fullPath);

    const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml"
    };

    res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream"
    });

    fs.createReadStream(fullPath).pipe(res);
});

const wss = new WebSocket.Server({
    server
});


/*
=========================================================
PARTIES
=========================================================
*/

const parties = new Map();

const CODE_CHARS =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";


function makeCode() {

    let code;

    do {

        code = "";

        for (let i = 0; i < 5; i++) {
            code += CODE_CHARS[
                Math.floor(
                    Math.random() * CODE_CHARS.length
                )
            ];
        }

    } while (parties.has(code));

    return code;
}


function makePlayerId() {

    return Math.random()
        .toString(36)
        .substring(2, 10)
        .toUpperCase();
}


function send(ws, data) {

    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}


function broadcast(party, data) {

    for (const player of party.players.values()) {
        send(player.ws, data);
    }
}


function lobbyData(party) {

    return {
        type: "lobby",
        code: party.code,
        hostId: party.hostId,
        started: party.started,

        players: Array.from(
            party.players.values()
        ).map(player => ({
            id: player.id,
            name: player.name
        }))
    };
}


/*
=========================================================
CREATE PARTY
=========================================================
*/

function createParty(ws, name) {

    const code = makeCode();
    const id = makePlayerId();

    const party = {
        code,
        hostId: id,
        started: false,

        players: new Map(),

        cards: [
            {
                id: 0,
                x: -32,
                z: -28,
                collected: false
            },
            {
                id: 1,
                x: 28,
                z: -16,
                collected: false
            },
            {
                id: 2,
                x: -20,
                z: 32,
                collected: false
            }
        ],

        monster: {
            x: 36,
            z: 30
        }
    };

    party.players.set(id, {
        id,
        name: name || "Player",
        ws,
        x: 0,
        y: 1.65,
        z: 0,
        rotation: 0
    });

    parties.set(code, party);

    ws.playerId = id;
    ws.partyCode = code;

    send(ws, {
        type: "partyCreated",
        code,
        playerId: id
    });

    broadcast(
        party,
        lobbyData(party)
    );
}


/*
=========================================================
JOIN PARTY
=========================================================
*/

function joinParty(ws, code, name) {

    code = String(code || "")
        .trim()
        .toUpperCase();

    const party = parties.get(code);

    if (!party) {

        send(ws, {
            type: "error",
            message: "Party not found."
        });

        return;
    }

    if (party.players.size >= 8) {

        send(ws, {
            type: "error",
            message: "That party is full."
        });

        return;
    }

    const id = makePlayerId();

    party.players.set(id, {
        id,
        name: name || "Player",
        ws,
        x: 0,
        y: 1.65,
        z: 0,
        rotation: 0
    });

    ws.playerId = id;
    ws.partyCode = code;

    send(ws, {
        type: "partyJoined",
        code,
        playerId: id
    });

    broadcast(
        party,
        lobbyData(party)
    );

    if (party.started) {

        send(ws, {
            type: "gameState",
            cards: party.cards,
            monster: party.monster,

            players: Array.from(
                party.players.values()
            ).map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                z: p.z,
                rotation: p.rotation
            }))
        });

    }
}


/*
=========================================================
START GAME
=========================================================
*/

function startGame(ws) {

    const party =
        parties.get(ws.partyCode);

    if (!party) return;

    if (party.hostId !== ws.playerId) {

        send(ws, {
            type: "error",
            message: "Only the host can start the game."
        });

        return;
    }

    party.started = true;

    broadcast(party, {
        type: "gameStarted"
    });

    setTimeout(() => {

        broadcast(party, {
            type: "gameState",

            cards: party.cards,

            monster: party.monster,

            players: Array.from(
                party.players.values()
            ).map(p => ({
                id: p.id,
                name: p.name,
                x: p.x,
                y: p.y,
                z: p.z,
                rotation: p.rotation
            }))
        });

    }, 200);
}


/*
=========================================================
PLAYER POSITION
=========================================================
*/

function updatePlayer(ws, data) {

    const party =
        parties.get(ws.partyCode);

    if (!party) return;

    const player =
        party.players.get(ws.playerId);

    if (!player) return;

    player.x =
        Number(data.x) || 0;

    player.y =
        Number(data.y) || 1.65;

    player.z =
        Number(data.z) || 0;

    player.rotation =
        Number(data.rotation) || 0;

    broadcast(party, {
        type: "playerUpdate",

        player: {
            id: player.id,
            name: player.name,
            x: player.x,
            y: player.y,
            z: player.z,
            rotation: player.rotation
        }
    });
}


/*
=========================================================
CARD COLLECTION
=========================================================
*/

function collectCard(ws, cardId) {

    const party =
        parties.get(ws.partyCode);

    if (!party) return;

    const card =
        party.cards.find(
            c => c.id === Number(cardId)
        );

    if (!card) return;

    if (card.collected) return;

    card.collected = true;

    broadcast(party, {
        type: "cardCollected",
        cardId: card.id
    });

    const allCollected =
        party.cards.every(
            c => c.collected
        );

    if (allCollected) {

        broadcast(party, {
            type: "allCardsCollected"
        });
    }
}


/*
=========================================================
PLAYER ESCAPES
=========================================================
*/

function playerEscaped(ws) {

    const party =
        parties.get(ws.partyCode);

    if (!party) return;

    const player =
        party.players.get(ws.playerId);

    if (!player) return;

    broadcast(party, {
        type: "playerEscaped",
        playerName: player.name
    });
}


/*
=========================================================
WEBSOCKET CONNECTION
=========================================================
*/

wss.on("connection", ws => {

    ws.on("message", raw => {

        let data;

        try {
            data = JSON.parse(raw.toString());
        } catch {
            return;
        }

        switch (data.type) {

            case "createParty":
                createParty(
                    ws,
                    data.name
                );
                break;

            case "joinParty":
                joinParty(
                    ws,
                    data.code,
                    data.name
                );
                break;

            case "startGame":
                startGame(ws);
                break;

            case "playerUpdate":
                updatePlayer(
                    ws,
                    data
                );
                break;

            case "collectCard":
                collectCard(
                    ws,
                    data.cardId
                );
                break;

            case "playerEscaped":
                playerEscaped(ws);
                break;
        }
    });


    ws.on("close", () => {

        const code = ws.partyCode;

        if (!code) return;

        const party =
            parties.get(code);

        if (!party) return;

        party.players.delete(
            ws.playerId
        );

        if (party.players.size === 0) {

            parties.delete(code);

            return;
        }

        /*
            If host leaves, give host
            control to another player.
        */

        if (party.hostId === ws.playerId) {

            const nextPlayer =
                party.players.values().next().value;

            party.hostId =
                nextPlayer.id;
        }

        broadcast(
            party,
            lobbyData(party)
        );
    });
});


server.listen(PORT, () => {

    console.log("");
    console.log("================================");
    console.log(" BACKROOMS MULTIPLAYER SERVER");
    console.log("================================");
    console.log("");
    console.log(
        `Server running on port ${PORT}`
    );
    console.log("");
});
