import { Server } from "socket.io";
import express from "express";
import cors from "cors";
import path from "path";

export const app = express();

const PORT = 4000;
const ALLOWED_ORIGINS = ["http://192.168.1.162:3000", "http://localhost:3000"];
//serve images
app.use("/images", express.static(path.join("./images")));

app.use(
  cors({
    origin: ALLOWED_ORIGINS, // Only allow this domain to make requests
  })
);

app.use(express.json());

// create server and give socket the same propreties to align with.
const httpServer = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

export const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
  },
});
