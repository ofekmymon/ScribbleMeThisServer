import fs from "fs/promises";
import crypto from "crypto";
import words from "./words.js";
import { io, app } from "./serverManager.js";
import Room from "./classes/roomClass.js";
import Message from "./classes/messageClass.js";
let rooms = []; // room list

//functions
async function sendAvatars() {
  const images = await fs.readdir("./images/Characters", (err, files) => {
    if (err) {
      return "error";
    }
    return files;
  });
  return images;
}
async function sendHats() {
  const images = await fs.readdir("./images/Hats", (err, files) => {
    if (err) {
      return "error";
    }
    return files;
  });
  return images;
}
function createRoom() {
  // create a room with a unique name and add the first player
  const roomName = crypto.randomBytes(30).toString("hex");
  const room = new Room(roomName);
  rooms.push(room);
  console.log(`created room ${roomName}`);
  return room;
}
function findAvailableRoom() {
  if (rooms.length > 0) {
    rooms.sort((a, b) => a.players - b.players); // sort rooms by descending to fill the lower rooms
    for (let i = 0; i < rooms.length; i++) {
      // skip full and private rooms
      if (rooms[i].players.length >= 8 || rooms[i].state === "private")
        continue;
      else {
        return rooms[i];
      }
    }
    const room = createRoom();
    return room;
  } else {
    const room = createRoom();
    return room;
  }
}
function findPlayerRoom(playerId) {
  const room = rooms.find((roomItem) =>
    roomItem.players.some((p) => p.id === playerId)
  );
  return room;
}
function removePlayerFromRoom(roomName, playerId) {
  const room = rooms.find((r) => r.name === roomName);
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== playerId);
  if (room.players.length === 0) {
    rooms = rooms.filter((r) => r.name !== roomName);
  }
}
function getWords(numberOfWords) {
  // gets words from the list
  // checks to see if data is valid and to avoid infinite loop
  if (
    !numberOfWords ||
    typeof numberOfWords !== "number" ||
    numberOfWords <= 0
  ) {
    return res
      .status(400)
      .json({ status: "error", message: "Invalid number of words requested" });
  }
  if (numberOfWords > words.length) {
    return res
      .status(400)
      .json({ status: "error", message: "Not enough words available" });
  }

  let wordsChosen = [];
  while (wordsChosen.length < numberOfWords) {
    const rnd = Math.floor(Math.random() * words.length);
    if (wordsChosen.includes(words[rnd])) {
      continue;
    }
    wordsChosen.push(words[rnd]);
  }
  console.log(wordsChosen);
  return { status: "success", words: wordsChosen };
}
// function changeTurns(room) {
//   const newOrder = [...room.players.slice(1), room.players[0]];
//   return newOrder;
// }
function getPlayer(id) {
  const room = findPlayerRoom(id);
  if (!room) return;
  const foundPlayer = room.players.find((player) => player.id === id);
  if (foundPlayer) {
    return foundPlayer;
  }
}
function createNotification(message, sender) {
  // create a specific message that is used for notification
  const notification = new Message(message, sender, false);
  notification.type = "notification";
  return notification;
}

// http requests
app.get("/api/get-avatars", async (req, res) => {
  const files = await sendAvatars();
  if (files && files.length > 0) {
    return res.json(files);
  }
  return res.status(500).json({ error: "Failed to send images" });
});

app.get("/api/get-hats", async (req, res) => {
  const files = await sendHats();
  if (files && files.length > 0) {
    return res.json(files);
  }
  return res.status(500).json({ error: "Failed to send images" });
});

app.post("/api/get-words", (req, res) => {
  // request to get the required number of words for the drawer to choose from.
  const numberOfWords = req.body.numberOfWords;
  return res.json(getWords(numberOfWords));
});

// socket connections
io.on("connection", (socket) => {
  console.log(`${socket.id} has joined`);

  socket.on("quick-play", (player) => {
    // player enters quickplay
    console.log(`Finding room for socket ${socket.id} name: ${player.name}...`);
    const room = findAvailableRoom();
    room.addPlayer(player);
    socket.join(room.name);
    socket.emit("joined-room", room.cleanRoom());
    console.log(`${player.name} has joined the room ${room.name}`);
    io.to(room.name).emit("room-update", room.cleanRoom());
    // send notification
    const notification = createNotification("Has Joined The Room", player.name);
    io.to(room.name).emit("get-message", notification);
  });

  socket.on("get-room", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      socket.emit("room-update", room.cleanRoom());
    }
  });

  socket.on("disconnect", () => {
    // disconnects a player from the server and removes them from room class
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    removePlayerFromRoom(room.name, player.id);
    console.log(`${player.name} has left ${room.name}`);
    io.to(room.name).emit("room-update", room.cleanRoom());
    // send notification
    const notification = createNotification("Has Left The Room", player.name);
    io.to(room.name).emit("get-message", notification);
  });

  socket.on("word-chosen", (word) => {
    // updates the new word chosen for the room
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.wordChosen = word;
    io.to(room.name).emit("room-update", room.cleanRoom());
    room.startTurn();
  });

  socket.on("send-message", (message) => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    const player = getPlayer(socket.id);
    if (!player) {
      console.log("player not found ");
      return;
    }
    // define indications
    const isCorrectGuess =
      message?.toLowerCase() === room.wordChosen?.toLowerCase();
    const isDrawer = player.id === room.players[0].id;
    const guessed = room.didPlayerGuess(socket.id);

    if (isCorrectGuess && !isDrawer && !guessed) {
      // if guessed the word
      room.addGuesser(player);
      const notification = createNotification(
        "Has Guessed The Word",
        player.name
      );
      io.to(room.name).emit("get-message", notification);
      io.to(room.name).emit("room-update", room.cleanRoom());
      console.log("player updated");
      return;
    }
    // create message
    const createMessage = new Message(message, player.name, guessed);

    if (isCorrectGuess && isDrawer) {
      // dont let the drawer message the word.
      return;
    }

    if (guessed) {
      // for players that guessed this round, only display their messages to eachother and the drawer
      const guessersSockets = [...room.getAllGuessersId(), room.players[0].id];
      io.sockets.to(guessersSockets).emit("get-message", createMessage);
      return;
    }
    io.to(room.name).emit("get-message", createMessage);
  });

  socket.on("get-player-scores", () => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    const players = room.getAllPlayerScores();
    socket.emit("player-scores", players);
  });

  socket.on("update-canvas", (drawingData) => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.drawing = drawingData;
    io.to(room.name).emit("update-drawing", drawingData);
  });

  socket.on("get-drawing", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      socket.emit("update-drawing", room.drawing);
    }
  });
  socket.on("clear-canvas", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      io.to(room.name).emit("reset-canvas");
    }
  });
});
