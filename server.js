import fs from "fs/promises";
import crypto from "crypto";
import words from "./words.js";
import { io, app } from "./serverManager.js";
import Room from "./classes/roomClass.js";
import Message from "./classes/messageClass.js";
const rooms = []; // room list

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

function generateRoomCode() {
  // creates a random unique code for the room.
  const existingCodes = new Set(rooms.map((room) => room.roomCode));
  let roomCode;
  do {
    roomCode = crypto.randomBytes(4).toString("hex"); // create an 8 digit code
  } while (existingCodes.has(roomCode));

  return roomCode;
}

function findPlayerRoom(playerId) {
  // find the room the player resides in.
  const room = rooms.find((roomItem) =>
    roomItem.players.some((p) => p.id === playerId)
  );
  return room;
}

function handleJoin(room, socket, player) {
  // standared when a player joins a room
  socket.emit("joined-room", room.cleanRoom());
  room.addPlayer(player);
  socket.join(room.name);
  console.log(`${player.name} has joined the room ${room.name}`);
  io.to(room.name).emit("room-update", room.cleanRoom());
  // send notification
  socket.on("player-joined", () => {
    const notification = createNotification(
      player.name,
      " Has Joined The Room"
    );
    io.to(room.name).emit("get-message", notification);
  });
}

function findRoomWithCode(code) {
  const room = rooms.find((room) => room.roomCode === code);
  console.log(rooms);

  return room;
}

function updateRoomDetails(room, details) {
  room.maxPlayers = details.maxPlayers;
  room.rounds = details.maxRounds;
  room.turnTime = details.turnTime;
  room.wordsOptionNumber = details.wordOptions;
}

function removePlayerFromRoom(playerId) {
  // removes a player from the room and re-calculate the rankings if was last player room leaves the list
  const room = findPlayerRoom(playerId);
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== playerId);
  room.calculateRanking(); // update the ranking after a player leaves

  // Clear intervals and timeouts if the room is empty or 1 left
  if (room.players.length <= 1) {
    if (room.countdown) {
      clearInterval(room.countdown);
      room.countdown = null;
    }
    room.resetRoom();
    if (room.players.length === 0) {
      const indexToRemove = rooms.indexOf(room);
      if (indexToRemove !== -1) {
        rooms.splice(indexToRemove, 1);
      }
    }
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
  return { status: "success", words: wordsChosen };
}

function getPlayer(id) {
  // gets player based on their socket id
  const room = findPlayerRoom(id);
  if (!room) return;
  const foundPlayer = room.players.find((player) => player.id === id);
  if (foundPlayer) {
    return foundPlayer;
  }
}

function createNotification(sender, message) {
  // create a specific message that is used for notification
  const notification = new Message(message, sender, false);
  notification.type = "notification";
  return notification;
}

// http requests
app.get("/", (req, res) => {
  return res.json("HWello");
});

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

// socket connections
io.on("connection", (socket) => {
  console.log(`${socket.id} has joined`);

  socket.on("quick-play", (player) => {
    // player enters quickplay
    console.log(`Finding room for socket ${socket.id} name: ${player.name}...`);
    const room = findAvailableRoom();
    handleJoin(room, socket, player);
  });

  socket.on("disconnect", () => {
    // disconnects a player from the server and removes them from room class
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    if (player === room.players[0] || room.players.length <= 2) {
      // if player is drawer or the last one left, end their turn.
      room.endTurn();
    }
    console.log(`${player.name} has left ${room.name}`);
    removePlayerFromRoom(player.id);
    if (room.players.length > 0) {
      io.to(room.name).emit("room-update", room.cleanRoom());
      // send notification
      const notification = createNotification(
        player.name,
        " Has Left The Room"
      );
      io.to(room.name).emit("get-message", notification);
    }
  });

  socket.on("create-private", (player) => {
    console.log("Creating New Private Room...");
    const room = createRoom();
    room.owner = player.id;
    room.roomCode = generateRoomCode();
    room.state = "private/settings"; // private but not defined yet
    handleJoin(room, socket, player);
    // send notification with the room code in it
    socket.once("player-joined", () => {
      const codeMsg = createNotification("The Room Code Is: ", room.roomCode);
      socket.emit("get-message", codeMsg);
    });
  });

  socket.on("request-to-join", (player, code) => {
    console.log(code);

    const room = findRoomWithCode(code);
    if (!room) {
      // if couldnt find room
      socket.emit("throw-frontpage-error", "Invalid code");
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      //if room full
      socket.emit("throw-frontpage-error", "Room full");
      return;
    }
    // join room
    handleJoin(room, socket, player);
  });

  socket.on("update-private-room", (details) => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    updateRoomDetails(room, details);
    io.to(room.name).emit("room-update", room.cleanRoom());
  });

  socket.on("initiate-private-room", () => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.state = "private";
    io.to(room.name).emit("room-update", room.cleanRoom());
  });

  //get data
  socket.on("get-room", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      socket.emit("room-update", room.cleanRoom());
    }
  });

  socket.on("get-player-scores", () => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    socket.emit("player-scores", room.players);
  });

  socket.on("get-drawing", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      socket.emit("update-drawing", room.drawing);
    }
  });

  socket.on("get-score-sorted-players", () => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    socket.emit("players-sorted-by-score", room.sortPlayersByScore());
  });
  // mutate data

  socket.on("get-words", () => {
    // starts the timer for the drawer to choose a word
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    const wordsRequest = getWords(room.wordsOptionNumber);
    if (wordsRequest.status !== "success") return; // if failed to get words, return
    const wordOptions = wordsRequest.words;
    socket.emit("word-options", wordOptions);
    let timer = 15;
    socket.emit("update-countdown", timer);
    room.countdown = setInterval(() => {
      timer--;
      socket.emit("update-countdown", timer);
      if (timer === 0) {
        clearInterval(room.countdown);
        // if timer ends a random word will be chosen
        const randomIndex = Math.floor(Math.random() * wordOptions.length);
        room.wordChosen = wordOptions[randomIndex];
        io.to(room.name).emit("room-update", room.cleanRoom());
        room.startTurn();
      }
    }, 1000);
  });

  socket.on("word-chosen", (word) => {
    // updates the new word chosen for the room
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.wordChosen = word;
    // clears the timer
    if (room.countdown) {
      clearInterval(room.countdown); // Stop the countdown
      room.countdown = null;
    }
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
      return;
    }
    // create message
    const createMessage = new Message(message, player.name, guessed);
    if (isCorrectGuess && isDrawer) {
      // dont let the drawer message the word.
      return;
    }
    // for players that guessed this round, only display their messages to eachother and the drawer
    if (guessed) {
      const guessersSockets = [...room.guessers, room.players[0].id];
      io.sockets.to(guessersSockets).emit("get-message", createMessage);
      return;
    }
    io.to(room.name).emit("get-message", createMessage);
  });

  socket.on("update-canvas", (drawingData) => {
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.drawing = drawingData;
    io.to(room.name).emit("update-drawing", drawingData);
  });

  socket.on("clear-canvas", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      io.to(room.name).emit("reset-canvas");
    }
  });
});
