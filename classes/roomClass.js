import { io } from "../serverManager.js";
export default class Room {
  // room class
  constructor(name) {
    // except the name all default values
    this.name = name;
    this.players = []; // lists the players in their order of play
    this.guessers = []; // lists all players who guessed
    this.round = 1;
    this.rounds = 3;
    this.turnTime = 700000; // the time of each turn as a reference to the changing time
    this.countdown = 0; // the changing timer of each turn
    this.roundLen = undefined; // the amount of turns before round ends
    this.roundCurrent = 0; // current index of number of turns in round
    this.maxPlayers = 8;
    this.wordsOptionNumber = 3;
    this.wordChosen = null;
    this.numberOfHints = 2;
    this.hintsOpened = []; // a list of indexes of the hints that have opened
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
    delete cleanRoom.countdown;
    delete cleanRoom.hintsOpened;
    return cleanRoom;
  }
  addPlayer(player) {
    this.players.push(player);
    this.calculateRanking(); // update ranking after a player joins
  }

  addGuesser(player) {
    const score = Math.max(250 - this.guessers.length * 30, 50); // first one gets 250 others get using the formula

    const timeBonus = Math.floor((this.turnTime - this.countdown) / 2); // the bonus for the time it took to guess
    const scoreToGet = Math.max(score + timeBonus, 50); // extra points for time to guess
    player.newScore = scoreToGet;
    player.score += scoreToGet;

    this.players[0].newScore += Math.max(100 + timeBonus, 50); // give the drawer points
    this.players[0].score += Math.max(100 + timeBonus, 50);

    this.guessers = [...this.guessers, player.id];
    // if all players guessed (excluding the drawer), end the turn
    const playersNoDrawer = this.players.slice(1);
    const isAllGuessers =
      this.guessers.length === playersNoDrawer.length &&
      playersNoDrawer.every((player) =>
        this.guessers.some((id) => id === player.id)
      );
    this.calculateRanking(); // updates the ranking of the players
    if (isAllGuessers) this.endTurn();
  }

  didPlayerGuess(id) {
    return this.guessers.some((player) => player === id);
  }
  // TODOOOOOO
  // WHEN RESETING THE ROOM RESET THE HINTS.
  // RECIEVE HINTS IN FRONTEND

  unlockHint() {
    if (
      this.countdown %
        Math.floor(
          this.turnTime /
            (Math.min(this.numberOfHints, this.wordChosen.length - 1) + 1)
        ) ==
        0 &&
      // dont reveal more hints than the length of the word chosen and dont reveal the last letter
      this.hintsOpened.length <
        Math.min(this.numberOfHints, this.wordChosen.length - 1)
    ) {
      let randomIndex;
      do {
        randomIndex = Math.floor(Math.random() * this.wordChosen.length);
      } while (
        this.hintsOpened.includes(randomIndex) ||
        this.wordChosen.charAt(randomIndex) === " "
      );
      this.hintsOpened.push(randomIndex);
      io.to(this.name).emit("get-hint", this.hintsOpened);
    }
    return;
  }

  startTimer() {
    // starts the room timer
    this.countdown = 0;
    io.to(this.name).emit("update-timer", this.turnTime);
    this.turnTimer = setInterval(() => {
      this.countdown++;
      // conditions to unlock a hint
      this.unlockHint();
      const timeLeft = this.turnTime - this.countdown;
      io.to(this.name).emit("update-timer", timeLeft);
      if (timeLeft === 0) {
        clearInterval(this.turnTimer);
        this.endTurn();
      }
    }, 1000);
  }

  stopTimer() {
    //stops the timer
    clearInterval(this?.turnTimer);
    // sends the frontend a queue to stop playing clock audio
    io.to(this.name).emit("stop-timer");
  }

  // functions to reset the room either for end turn or for session
  resetGuessers() {
    this.guessers = [];
    if (this.players.length > 0) {
      this.players?.forEach((player) => {
        if (player?.newScore) player.newScore = 0;
      }); // reset the new scores of the players
    }
  }

  resetAllScores() {
    if (this.players.length > 0) {
      this.players.forEach((player) => (player.score = 0));
    }
  }

  changeTurns() {
    this.players = [...this.players.slice(1), this.players[0]];
    this.wordChosen = null;
    io.to(this.name).emit("room-update", this.cleanRoom());
    io.to(this.name).emit("change-turn");
  }

  startTurn() {
    // start the turn timer and advence the currentRound length
    this.startTimer();
    this.roundCurrent++;
    if (this.roundCurrent === 1) {
      // on the first turn of the round, decide the length of the round.
      this.roundLen = this.players.length;
    }
  }
  resetRoom() {
    // reset the values in the room for the next turn
    this.drawing = [];
    this.drawingHistory = [];
    this.resetGuessers();
    this.hintsOpened = [];
    io.to(this.name).emit("reset-canvas");
    this.wordChosen = null;
    clearInterval(this?.turnTimer);
    this.turnTimer = null;
    clearInterval(this?.countdown);
    this.countdown = null;
  }

  endTurn() {
    this.stopTimer(); // stop the game timer
    const RoundLength = Math.min(this.players.length, this.roundLen);
    io.to(this.name).emit("turn-ended"); // end session or end turn
    this.guessers = []; // reset the guessers so they could chat with the other players
    let timer = 10;
    io.to(this.name).emit("update-countdown", timer);
    // check if round ended
    if (this.roundCurrent >= RoundLength) {
      this.round++;
      this.roundCurrent = 0; // reset round index
    }
    this.turnTimer = setInterval(() => {
      timer--;
      io.to(this.name).emit("update-countdown", timer);
      if (timer === 0) {
        // handle timer
        clearInterval(this.turnTimer);
        this.resetRoom(); // reset room values
        io.to(this.name).emit("continue-game"); // to leave the current endturn state
        if (this.round > this.rounds) {
          this.endSession();
        } else {
          this.changeTurns();
        }
      }
    }, 1000);
  }

  calculateRanking() {
    // get the rank of each player, same score = same rank
    let playersByRank = [...this.players];
    playersByRank.sort((a, b) => b.score - a.score);
    let rank = 0;
    let prevScore = undefined;
    playersByRank.forEach((player, index) => {
      if (player.score !== prevScore) {
        rank++;
      }
      player.rank = rank;
      prevScore = player.score;
    });
  }
  resetToDefault() {
    //after session reset propreties to default
    this.players.forEach((player) => (player.score = 0));
    this.round = 1;
    this.calculateRanking();
  }

  endSession() {
    io.to(this.name).emit("end-session");
    this.players = this.sortPlayersByScore(); // sort players by score
    let timer = 30;
    io.to(this.name).emit("update-countdown", timer);
    this.turnTimer = setInterval(() => {
      timer--;
      io.to(this.name).emit("update-countdown", timer);
      if (timer === 0) {
        clearInterval(this.turnTimer);
        this.resetToDefault();
        io.to(this.name).emit("room-update", this.cleanRoom());
        io.to(this.name).emit("continue-game"); // leave the current game state
      }
    }, 1000);
  }

  sortPlayersByScore() {
    const players = [...this.players];
    players.sort((a, b) => b.score - a.score);
    return players;
  }

  checkIfRemove() {
    // check if room should be deleted
    if (this.players.length === 0) return true;
  }
}
