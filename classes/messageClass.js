export default class Message {
  constructor(content, sender, didGuess) {
    this.content = content;
    this.sender = sender;
    this.didGuess = didGuess;
    this.type = "message";
  }
}
