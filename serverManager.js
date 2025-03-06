import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import path from "path";

export const app = express();

const PORT = 4000;

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

export const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:3000",
  },
});
