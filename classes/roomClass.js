import { io } from "../serverManager.js";
export default class Room {
  // room class
  constructor(name) {
    // except the name all default values
    this.name = name;
    this.players = []; // lists the players in their order of play
    this.guessers = []; // lists all players who guessed and how much points they got
    this.round = 1;
    this.rounds = 3;
    this.turnTime = 900; // the time of each turn as a reference to the changing time
    this.roundLen = undefined; // the amount of turns before round ends
    this.roundCurrent = 0; // current index of number of turns in round
    this.maxPlayers = 8;
    this.wordsOptionNumber = 3;
    this.wordChosen = null;
    this.state = "public";
    this.owner = null;
    this.roomCode = "";
    this.drawing = undefined; // saves the drawing proprety to update when entering room
  }
  cleanRoom() {
    // cleans the room class before sending it to the client. removes timers to avoid circular references
    const cleanRoom = { ...this };
    delete cleanRoom.turnTimer;
    delete cleanRoom.drawing;
    return cleanRoom;
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
    io.to(this.name).emit("room-update", this.cleanRoom());
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
    //drawing reset
    this.drawing = [];
    this.drawingHistory = [];
    io.to(this.name).emit("reset-canvas");

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
