import express from "express";
import bodyParser from "body-parser";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let nodeState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  type Message = {
    sender: number;
    round: number;
    value: Value;
    phase: "DECLARE" | "VOTE";
  };

  node.get("/status", (req, res) => {
    if (nodeState.x === null || nodeState.decided === null || nodeState.k === null) {
      return res.status(500).send("faulty");
    }
    return res.status(500).send('live');
  });

  node.get("/start", async (req, res) => {
    if (isFaulty || nodeState.killed) {
      return res.status(500).send("Node is faulty or stopped");
    }
    if (!nodesAreReady()) {
      return res.status(400).send("Nodes are not ready yet");
    }

    nodeState.k = 1;
    executeAlgorithm();
    return res.status(200).send("Consensus started");
  });

  node.get("/stop", async (req, res) => {
    nodeState.killed = true;
    return res.status(200).send("Stop");
  });

  node.post("/message", (req, res) => {
    if (nodeState.killed || isFaulty) {
      return res.status(500).send("Node stopped or faulty");
    }
    const message = req.body;
    if (!isFaulty && !nodeState.killed) {
      if (message && message.round !== undefined && message.value !== undefined && message.phase) {
        receivedMessages.push(message);
      }
    }
    return res.status(200).send("Message received");
  });

  

  let receivedMessages: Message[] = [];

  async function executeAlgorithm() {
    let maxIterations = 50;
    while (!nodeState.decided && !nodeState.killed && maxIterations > 0) {
      maxIterations--;
      await sendMessageToAll(nodeState.x!, "DECLARE");
      await new Promise(resolve => setTimeout(resolve, 50));

      const proposals = receivedMessages.filter(msg => msg.round === nodeState.k && msg.phase === "DECLARE");
      const count0 = proposals.filter(m => m.value === 0).length;
      const count1 = proposals.filter(m => m.value === 1).length;
      let voteValue: Value | null = count0 >= Math.floor((N - F) / 2) + 1 ? 0 : count1 >= Math.floor((N - F) / 2) + 1 ? 1 : ((nodeState.k! + nodeId) % 2) as Value;
      
      await sendMessageToAll(voteValue, "VOTE");
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const votes = receivedMessages.filter(msg => msg.round === nodeState.k && msg.phase === "VOTE");
      const votes0 = votes.filter(m => m.value === 0).length;
      const votes1 = votes.filter(m => m.value === 1).length;
      const majority = Math.floor(N / 2) + 1;
      const faultThreshold = Math.floor((N - F) / 2) + 1;

      if (votes0 >= majority) {
        nodeState.x = 0;
        if (votes0 >= N - F) nodeState.decided = true;
      } else if (votes1 >= majority) {
        nodeState.x = 1;
        if (votes1 >= N - F) nodeState.decided = true;
      } else {
        nodeState.x = ((nodeState.k! + nodeId) % 2) as Value;
      }
      
      if (nodeState.k! >= 3 && !nodeState.decided) {
        if (N - F <= F) nodeState.decided = false;
        else if (votes0 >= faultThreshold || votes1 >= faultThreshold) nodeState.decided = true;
      }
      receivedMessages = receivedMessages.filter(msg => msg.round >= nodeState.k!);
      nodeState.k! += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  async function sendMessageToAll(value: Value, phase: "DECLARE" | "VOTE") {
    let message = { sender: nodeId, round: nodeState.k!, value, phase }
    if (!isFaulty && !nodeState.killed) {
      if (message.value !== undefined && message.phase && message && message.round !== undefined) {
        receivedMessages.push(message);
      }
    }
    const promises = [];
    for (let i = 0; i < N; i++) {
      if (i !== nodeId) {
        promises.push(
          fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender: nodeId, round: nodeState.k, value, phase })
          }).catch((err) => {throw err})
        );
      }
    }
    await Promise.all(promises);
  }

  node.get("/getState", (req, res) => {
    res.status(200).json(nodeState);
  });

  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`🚀 Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  return server;
}