// Read-only extraction from the sibling Calcit project. Preserve exact source bodies.
import { readFileSync, writeFileSync } from "node:fs";
const sourcePath = "../soluble/calcit.cirru";
const lines = readFileSync(
  new URL(sourcePath, new URL("../", import.meta.url)),
  "utf8",
).split("\n");
const extract = (name) => {
  const start = lines.findIndex(
    (line) =>
      line.includes(`:code $ quote $ defn ${name} `) ||
      line.includes(`:code $ quote $ defcomp ${name} `),
  );
  if (start < 0) throw new Error(`Missing function ${name}`);
  let end = start + 1;
  while (end < lines.length && /^ {12}/.test(lines[end])) end++;
  const body = [
    lines[start].split(":code $ quote $ ")[1],
    ...lines.slice(start + 1, end).map((line) => line.slice(10)),
  ].join("\n");
  return { name, line: start + 1, endLine: end, code: body };
};
const groups = [
  {
    title: "Soluble · 应用全景",
    names: [
      "comp-container",
      "comp-nav",
      "main!",
      "get-app",
      "load-textures!",
      "handle-gamepad!",
      "reload!",
      "render-app!",
      "updater",
    ],
  },
  { title: "Soluble · 导航组件", names: ["comp-container", "comp-nav"] },
  {
    title: "Soluble · 异步初始化",
    names: ["main!", "load-textures!", "handle-gamepad!", "reload!"],
  },
  { title: "Soluble · 渲染器分发", names: ["get-app", "updater"] },
];
const examples = groups.map((group) => {
  const excerpts = group.names.map(extract);
  return {
    title: group.title,
    source: "soluble/calcit.cirru",
    excerpts,
    code: excerpts.map((e) => e.code).join("\n\n"),
  };
});
writeFileSync(
  new URL("../src/repository-examples.json", import.meta.url),
  JSON.stringify(examples, null, 2) + "\n",
);
console.log(
  examples
    .map((e) => `${e.title}: ${e.code.split("\n").length} lines`)
    .join("\n"),
);
