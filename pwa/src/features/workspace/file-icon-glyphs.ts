import {
  Atom, BadgeCheck, Boxes, Braces, CodeXml, Coffee, Database, Droplet,
  FileArchive, FileCode, FileSymlink, FileText, FileVideo, Folder, Gem,
  GitBranch, Hash, Hexagon, Image, KeyRound, Lambda, List, LockKeyhole,
  Moon, Package, PenTool, Settings, Snowflake, SquareTerminal, Type,
  Volume2, Zap, type LucideIcon,
} from "lucide-react";

export type GlyphPart = {
  d: string;
  stroke?: true;
  width?: number;
  evenodd?: true;
  transform?: string;
};

export type GlyphId =
  | "folder" | "file" | "symlink" | "hex" | "shield" | "atom" | "braces" | "tag"
  | "hash" | "drop" | "md" | "py" | "go" | "gear" | "gem" | "cup" | "c" | "cpp"
  | "prompt" | "boxes" | "git" | "bars" | "vue" | "photo" | "lock" | "cube"
  | "badge" | "zip" | "type" | "speaker" | "play" | "pdf" | "db" | "key"
  | "graphql" | "svelte" | "php" | "moon" | "lambda" | "bolt" | "flake" | "zig"
  | "dart" | "vector";

export type FileIconId =
  | "folder" | "symlink" | "file" | "js" | "ts" | "react" | "json" | "html" | "css"
  | "sass" | "less" | "md" | "py" | "go" | "rs" | "rb" | "java" | "c" | "cpp"
  | "csharp" | "sh" | "sql" | "php" | "swift" | "kt" | "dart" | "lua" | "vue"
  | "svelte" | "astro" | "yaml" | "toml" | "xml" | "svg" | "docker" | "git" | "npm"
  | "lock" | "env" | "license" | "config" | "make" | "image" | "font" | "pdf" | "zip"
  | "audio" | "video" | "csv" | "graphql" | "proto" | "prisma" | "terraform" | "text"
  | "binary" | "wasm" | "elixir" | "haskell" | "scala" | "r" | "nix" | "zig" | "bun"
  | "vite";

const f = (d: string, extra?: Omit<GlyphPart, "d">): GlyphPart => ({ d, ...extra });
const s = (d: string, width = 1.25, extra?: Omit<GlyphPart, "d" | "stroke" | "width">): GlyphPart => (
  { d, stroke: true, width, ...extra }
);

export type FileGlyph = { icon: LucideIcon } | { paths: readonly GlyphPart[] };

export const FILE_ICON_GLYPHS: Record<GlyphId, FileGlyph> = {
  folder: { icon: Folder },
  file: { icon: FileText },
  symlink: { icon: FileSymlink },
  hex: { icon: Hexagon },
  shield: { icon: FileCode },
  atom: { icon: Atom },
  braces: { icon: Braces },
  tag: { icon: CodeXml },
  hash: { icon: Hash },
  drop: { icon: Droplet },
  md: { paths: [f("M2.15 12.55V3.45h2.2l3.65 5.85 3.65-5.85h2.2v9.1h-1.95V6.7L9.05 11.5H6.95L4.1 6.7v5.85z")] },
  py: { paths: [
    f("M5.55 3.15a3.55 3.55 0 1 1 0 7.1 3.55 3.55 0 0 1 0-7.1z"),
    f("M10.45 5.75a3.55 3.55 0 1 1 0 7.1 3.55 3.55 0 0 1 0-7.1z"),
  ] },
  go: { paths: [f("M3.15 4.2h9.7A2.25 2.25 0 0 1 15.1 6.45v3.1A2.25 2.25 0 0 1 12.85 11.8H3.15A2.25 2.25 0 0 1 .9 9.55v-3.1A2.25 2.25 0 0 1 3.15 4.2z")] },
  gear: { icon: Settings },
  gem: { icon: Gem },
  cup: { icon: Coffee },
  c: { paths: [s("M11.45 4.25a4.7 4.7 0 1 0 .05 7.5", 2.05)] },
  cpp: { paths: [
    s("M10.35 4.35a4.55 4.55 0 1 0 .05 7.3", 1.95),
    f("M11.15 6.55h1.35V5.2h1.2v1.35H14.9v1.2h-1.2v1.35h-1.2V7.75h-1.35z"),
  ] },
  prompt: { icon: SquareTerminal },
  boxes: { icon: Boxes },
  git: { icon: GitBranch },
  bars: { icon: List },
  vue: { paths: [f("M1.7 3.2h3.65L8 8.85 10.65 3.2h3.65L8 14.05z")] },
  photo: { icon: Image },
  lock: { icon: LockKeyhole },
  cube: { icon: Package },
  badge: { icon: BadgeCheck },
  zip: { icon: FileArchive },
  type: { icon: Type },
  speaker: { icon: Volume2 },
  play: { icon: FileVideo },
  pdf: { icon: FileText },
  db: { icon: Database },
  key: { icon: KeyRound },
  graphql: { paths: [
    f("M8 1.35 13.9 4.8v6.4L8 14.65 2.1 11.2V4.8zM8 5.15 5.2 10.05h5.6z", { evenodd: true }),
  ] },
  svelte: { paths: [
    s("M10.7 3.7c-1.55-1.4-4-.95-5.05.85L4.2 7.05c-.7 1.2-.15 2.55 1.15 3.1M5.3 12.3c1.55 1.4 4 .95 5.05-.85l1.45-2.5c.7-1.2.15-2.55-1.15-3.1", 1.45),
  ] },
  php: { paths: [f("M2.55 5.15h10.9A2.35 2.35 0 0 1 15.8 7.5v1A2.35 2.35 0 0 1 13.45 10.85H2.55A2.35 2.35 0 0 1 .2 8.5v-1A2.35 2.35 0 0 1 2.55 5.15z")] },
  moon: { icon: Moon },
  lambda: { icon: Lambda },
  bolt: { icon: Zap },
  flake: { icon: Snowflake },
  zig: { paths: [f("M3.05 3.25h6.35L4.2 12.75h8.75v1.6H6.6L11.8 4.85H3.05z")] },
  dart: { paths: [f("M8 1.5 13.7 8 8 14.5 4.4 10.9h4.05V5.1H4.4z")] },
  vector: { icon: PenTool },
};

export const FILE_ICON_GLYPH: Record<FileIconId, GlyphId> = {
  folder: "folder",
  symlink: "symlink",
  file: "file",
  text: "file",
  binary: "file",
  js: "hex",
  wasm: "hex",
  ts: "shield",
  react: "atom",
  json: "braces",
  html: "tag",
  xml: "tag",
  css: "hash",
  less: "hash",
  sass: "drop",
  elixir: "drop",
  md: "md",
  py: "py",
  go: "go",
  rs: "gear",
  config: "gear",
  make: "gear",
  rb: "gem",
  java: "cup",
  c: "c",
  csharp: "c",
  cpp: "cpp",
  sh: "prompt",
  docker: "boxes",
  terraform: "boxes",
  git: "git",
  yaml: "bars",
  toml: "bars",
  proto: "bars",
  vue: "vue",
  svelte: "svelte",
  astro: "svelte",
  image: "photo",
  svg: "vector",
  lock: "lock",
  npm: "cube",
  bun: "cube",
  license: "badge",
  zip: "zip",
  font: "type",
  audio: "speaker",
  video: "play",
  pdf: "pdf",
  sql: "db",
  csv: "db",
  prisma: "db",
  env: "key",
  graphql: "graphql",
  php: "php",
  lua: "moon",
  haskell: "lambda",
  scala: "lambda",
  vite: "bolt",
  nix: "flake",
  zig: "zig",
  dart: "dart",
  kt: "dart",
  swift: "dart",
  r: "c",
};
