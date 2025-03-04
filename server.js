import express from "express";
import path from "path";
import fs from "fs/promises";
import cors from "cors";
import { Server } from "socket.io";
import crypto from "crypto";
import words from "./words.js";
const app = express();
const PORT = 4000;
let rooms = [];
//serve images
app.use("/images", express.static(path.join("./images")));

app.use(
  cors({
    origin: "http://localhost:3000", // Only allow this domain to make requests
  })
);
app.use(express.json());

// create server and give socket the same propreties to align with.
const httpServer = app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
  },
});

//classes
class Room {
  // room class
  constructor(name) {
    // except the name all default values
    this.name = name;
    this.players = []; // lists the players in their order of play
    this.guessers = []; // lists all players who guessed and how much points they got
    this.round = 1;
    this.rounds = 3;
    this.turnTime = 100; // the time of each turn as a reference to the changing time
    this.roundLen = undefined; // the amount of turns before round ends
    this.roundCurrent = 0; // current index of number of turns in round
    this.maxPlayers = 8;
    this.wordsOptionNumber = 3;
    this.wordChosen = null;
    this.state = "public";
    this.owner = null;
    this.roomCode = "";
  }
  addPlayer(player) {
    this.players.push(player);
  }
  checkIfRemove() {
    // check if room should be deleted
    if (this.players.length === 0) return true;
  }
  resetGuessers() {
    this.guessers = [];
  }
  addGuesser(player) {
    const scoreToGet =
      this.guessers.length !== 0
        ? this.guessers[this.guessers.length - 1].score -
          100 / this.guessers.length
        : 250; // if first one get 250 otherwise get using the formula
    player.score += scoreToGet;
    this.players[0].score += 100; // give the drawer 100 points per each guesser
    this.guessers = [...this.guessers, { id: player.id, score: scoreToGet }];
    // if all players guessed (excluding the drawer), end the turn
    const playersNoDrawer = this.players.slice(1);
    const isAllGuessers =
      this.guessers.length === playersNoDrawer.length &&
      playersNoDrawer.every((player) =>
        this.guessers.some((guesser) => guesser.id === player.id)
      );
    if (isAllGuessers) this.endTurn();
  }
  didPlayerGuess(id) {
    return this.guessers.some((player) => player.id === id);
  }
  getAllGuessersId() {
    const guessers = this.guessers.map((player) => player.id);
    return guessers;
  }
  getAllPlayerScores() {
    // returns a list of player objects with score earned and id
    return this.players.map((player) => {
      for (let i = 0; i < this.guessers.length; i++) {
        if (this.guessers[i].id === player.id) {
          player.newScore = this.guessers[i].score || 0;
          return player;
        } else if (i === 0) {
          player.newScore = this.guessers.length * 100;
          return player;
        }
      }
      player.newScore = 0;
      return player;
    });
  }
  startTimer() {
    // starts the room timer.
    let countdown = this.turnTime;
    this.turnTimer = setInterval(() => {
      io.to(this.name).emit("update-timer", countdown);
      countdown--;
      if (countdown <= 0) {
        io.to(this.name).emit("update-timer", countdown);
        this.endTurn();
        clearInterval(this.turnTimer);
      }
    }, 1000);
  }
  stopTimer() {
    //stops the timer
    clearInterval(this?.turnTimer);
  }
  changeTurns() {
    this.stopTimer(); // might remove
    this.players = [...this.players.slice(1), this.players[0]];
    this.wordChosen = null;
    this.resetGuessers();
    io.to(this.name).emit("room-update", cleanRoom(this));
    io.to(this.name).emit("change-turn");
  }
  startTurn() {
    this.startTimer();
    this.roundCurrent++;
    if (this.roundCurrent === 1) {
      // on the first turn of the round, decide the length of the round.
      this.roundLen = this.players.length;
    }
  }
  endTurn() {
    // check if round ended // TODO check if turn ended
    const RoundLength = Math.min(this.players.length, this.roundLen);
    if (this.roundCurrent >= RoundLength) {
      this.round++;
      this.roundCurrent = 0; // reset round index
    }

    io.to(this.name).emit("turn-ended");
    let timer = 10;
    const turnTimer = setInterval(() => {
      io.to(this.name).emit("update-countdown", timer);
      timer--;
      if (timer === 0) {
        io.to(this.name).emit("update-countdown", timer);
        clearInterval(turnTimer);
        this.changeTurns();
      }
    }, 1000);
  }
}

class Message {
  constructor(content, sender, didGuess) {
    this.content = content;
    this.sender = sender;
    this.didGuess = didGuess;
    this.type = "message";
  }
}

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
function cleanRoom(room) {
  // cleans the room class before sending it to the client. removes timers to avoid circular references
  const cleanRoom = { ...room };
  delete cleanRoom.turnTimer;
  return cleanRoom;
}
function changeTurns(room) {
  const newOrder = [...room.players.slice(1), room.players[0]];
  return newOrder;
}
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
    socket.emit("joined-room", room);
    console.log(`${player.name} has joined the room ${room.name}`);
    io.to(room.name).emit("room-update", cleanRoom(room));
    // send notification
    const notification = createNotification("Has Joined The Room", player.name);
    io.to(room.name).emit("get-message", notification);
  });

  socket.on("get-room", () => {
    const room = findPlayerRoom(socket.id);
    if (room) {
      socket.emit("room-update", cleanRoom(room));
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
    io.to(room.name).emit("room-update", cleanRoom(room));
    // send notification
    const notification = createNotification("Has Left The Room", player.name);
    io.to(room.name).emit("get-message", notification);
  });

  socket.on("word-chosen", (word) => {
    // updates the new word chosen for the room
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.wordChosen = word;
    io.to(room.name).emit("room-update", cleanRoom(room));
    room.startTurn();
  });

  socket.on("send-message", (message) => {
    debugger;
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
      io.to(room.name).emit("room-update", cleanRoom(room));

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
});
