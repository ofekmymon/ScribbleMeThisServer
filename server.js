import express from "express";
import path from "path";
import fs from "fs/promises";
import cors from "cors";
import { Server } from "socket.io";
import crypto from "crypto";
import { log } from "console";
import words from "./words.js"
import { stat } from "fs";
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
    this.players = []; // lists the players in their order
    this.round = 1;
    this.rounds = 3;
    this.roundTime = 100;
    this.maxPlayers = 8;
    this.wordsOptionNumber = 3;
    this.wordChosen = null;
    this.state = "public";
    this.owner = null;
    this.roomCode = '';
  }
  addPlayer(player) {
    this.players.push(player);
  }
  checkIfRemove() {
    if (this.players.length === 0) return true;
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
function findAvailableRoom(){
  if (rooms.length > 0) {
    rooms.sort((a, b) => a.players - b.players); // sort rooms by descending to fill the lower rooms
    for (let i = 0; i < rooms.length; i++) {
      if (rooms[i].players.length >= 8 || rooms[i].state === "private") continue; // if room is full, skip
      else{return rooms[i]};
    }
    const room = createRoom();
    return room; 
  }
  else{
    const room = createRoom();
    return room;
  }
}
function findPlayerRoom(playerId){
  const room = rooms.find((roomItem) => roomItem.players.some((p) => p.id === playerId));
  return room;
}
function removePlayerFromRoom(roomName, playerId){
  const room = rooms.find(r => r.name === roomName);
  if (!room) return;
  room.players = room.players.filter((player) => player.id !== playerId);
  if (room.players.length === 0) {
    rooms = rooms.filter((r) => r.name !== roomName);
  }
}
function getWords(numberOfWords){
  // gets words from the list 
  // checks to see if data is valid and to avoid infinite loop
  if (!numberOfWords || typeof numberOfWords !== "number" || numberOfWords <= 0) {
    return res.status(400).json({ status: "error", message: "Invalid number of words requested" });
  }
  if (numberOfWords > words.length) {
    return res.status(400).json({ status: "error", message: "Not enough words available" });
  }

  let wordsChosen = [];
  while(wordsChosen.length < numberOfWords){
    const rnd = Math.floor(Math.random() * words.length);
    if(wordsChosen.includes(words[rnd])){
      continue;
    }
    wordsChosen.push(words[rnd])
  }
  console.log(wordsChosen);
  return {status:"success", words:wordsChosen}
}
function changeTurns(room){
  const newOrder = [...room.players.slice(1), room.players[0]];
  return newOrder;
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
  return res.json(getWords(numberOfWords))
}); 

// socket connections
io.on("connection", (socket) => {
  console.log(`${socket.id} has joined`);
  socket.on("quick-play", (player) => {
    console.log(`Finding room for socket ${socket.id} name: ${player.name}...`);
    const room = findAvailableRoom()
    room.addPlayer(player);
    socket.join(room.name);
    socket.emit("joined-room" , room);
    console.log(`${player.name} has joined the room ${room.name}`);
    
    io.to(room.name).emit("room-update",room);
  });
  socket.on("get-room", ()=>{
    const room = findPlayerRoom(socket.id);
    if(room){
      socket.emit("room-update", room)
    }
  })

  socket.on("disconnect", ()=>{
    // disconnects a player from the server and removes them from room class
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    removePlayerFromRoom(room.name, player.id);
    console.log(`${player.name} has left ${room.name}`);
    io.to(room.name).emit("room-update", room);
  })

  socket.on("word-chosen", (word)=>{
    // updates the new word chosen for the room
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.wordChosen = word;
    io.to(room.name).emit("room-update", room)
  })

  socket.on("change-turns", () => {
    // changes turns, the player played goes to the back and the word becomes null
    const room = findPlayerRoom(socket.id);
    if (!room) return;
    room.players = changeTurns(room);
    room.wordChosen = null;
    io.to(room.name).emit("room-update",room);
  })
});

