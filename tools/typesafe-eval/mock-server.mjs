// A local stand-in for POST /v1/systemone, for testing coach.mjs without a key or a cent.
// It checks the request against the documented contract and answers with crude keyword
// rules. Its answers say nothing about what the real model would say.

import { createServer } from "node:http";

const pathOf = (instructions) => [...instructions.matchAll(/`plan\.tasks\[(\d+)\]\.title`/g)].map((m) => Number(m[1]));
const words = (s) => new Set(s.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w.length > 3));

function answer(q, state) {
  const idx = pathOf(q.instructions);
  const title = (i) => state.plan.tasks[i].title;
  if (q.type === "noul") {
    const text = title(idx[0]).toLowerCase();
    if (idx.length === 2) {
      const a = words(title(idx[0]));
      const shared = [...words(title(idx[1]))].filter((w) => a.has(w)).length;
      return { type: "noul", noul: shared >= 2 ? 0.91 : 0.04 };
    }
    if (q.instructions.includes("more than one distinct")) return { type: "noul", noul: /\band (decide|also|then)\b/.test(text) ? 0.9 : 0.08 };
    return { type: "noul", noul: /^(work on|think about|look into)\b/.test(text) ? 0.1 : 0.93 };
  }
  if (q.type === "score") {
    const text = title(idx[0]).toLowerCase();
    const level = /end to end|rewrite/.test(text) ? 3 : /draft|clean up/.test(text) ? 2 : /^(book|call|ring|reply|gym|send)/.test(text) ? 0 : 1;
    const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), c]));
    const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === level ? 0.85 : 0.05]));
    return { type: "score", score: level * 0.85 + 0.15, legend, probabilities, confidence: 0.8 };
  }
  const text = title(idx[0]).toLowerCase();
  const choice = /^(send|call|ring|reply)/.test(text) ? "communication" : /^(book|clean)/.test(text) ? "admin" : /^think/.test(text) ? "planning" : /gym/.test(text) ? "personal" : "deep_work";
  const probabilities = Object.fromEntries(Object.keys(q.criteria).map((k) => [k, k === choice ? 0.9 : 0.02]));
  return { type: "choice", choice, probabilities, confidence: 0.86 };
}

function invalid(body) {
  if (body.state === undefined) return "state is required";
  if (typeof body.model !== "string") return "model is required";
  if (!body.questions || typeof body.questions !== "object") return "questions is required";
  for (const [id, q] of Object.entries(body.questions)) {
    if (!["noul", "choice", "score"].includes(q.type)) return `${id}: unknown type`;
    if (!q.instructions) return `${id}: instructions is required`;
    if (q.type === "choice" && (typeof q.criteria !== "object" || Array.isArray(q.criteria))) return `${id}: choice criteria must be a map`;
    if (q.type === "score" && (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10)) return `${id}: score criteria must list 2 to 10 levels`;
  }
  return null;
}

/** `busyFirst`: answer this many requests with 529 before behaving, to exercise the retry. */
export function start({ busyFirst = 0 } = {}) {
  let busy = busyFirst;
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status, obj) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.method !== "POST" || req.url !== "/v1/systemone") return send(404, { error: "not found" });
      if (!/^Bearer \S+/.test(req.headers.authorization ?? "")) return send(401, { error: "Missing or invalid API key" });
      if (busy > 0) return busy--, send(529, { error: "overloaded" });
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return send(422, { error: "body is not JSON" });
      }
      const problem = invalid(body);
      if (problem) return send(422, { error: problem });
      seen.push(body);
      const answers = Object.fromEntries(Object.entries(body.questions).map(([id, q]) => [id, answer(q, body.state)]));
      send(200, { model: body.model, answers, usage: { input_tokens: Math.ceil(raw.length / 4), output_tokens: Object.keys(answers).length * 4 } });
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}
