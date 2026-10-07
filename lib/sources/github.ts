import { readFile } from "node:fs/promises";
import path from "node:path";
import type { KnowledgeUnit } from "../models";
import type { SourceAdapter } from "./types";

/**
 * Optional owner statement about the public profile, appended verbatim to the footprint unit.
 *
 * Kept in a file rather than in code because it is a judgement only the profile's owner can make
 * ("these are tutorial repos", "the real projects are private"). Absent means no statement is made.
 */
const NOTE_PATH = path.join(process.cwd(), "knowledge", "sources", "github-note.md");

async function readOwnerNote(): Promise<string | undefined> {
  try {
    const note = (await readFile(NOTE_PATH, "utf8")).trim();
    return note || undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  fork: boolean;
  updated_at: string;
  stargazers_count: number;
}

/** `username` comes from GITHUB_USERNAME. Not configured means this adapter is never built. */
export const createGithubAdapter = (username: string): SourceAdapter => ({
  name: "github",
  description: `Public repositories for github.com/${username} via the unauthenticated REST API`,

  async load(): Promise<KnowledgeUnit[]> {
    const apiUrl = `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`;
    const response = await fetch(apiUrl, {
      headers: { accept: "application/vnd.github+json", "user-agent": "ai-interactive-resume" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub API returned ${response.status}`);
    }

    const repos = (await response.json()) as Repo[];
    const retrievedAt = new Date().toISOString().slice(0, 10);

    const units: KnowledgeUnit[] = repos.map((repo) => ({
      // Repo names are already URL-safe and unique per user, so they are used almost verbatim.
      // Collapsing "-" and "_" to one separator would collide "github-battle" with "github_battle",
      // which are two real, distinct repositories on this profile.
      id: `github:repo-${repo.name.toLowerCase()}`,
      source: "github",
      unitType: "repository",
      title: `Public repository: ${repo.name}`,
      text: [
        `Public GitHub repository "${repo.name}"${repo.fork ? " (a fork)" : ""}.`,
        repo.description ? `Description: ${repo.description}` : "No description set.",
        repo.language ? `Primary language: ${repo.language}.` : undefined,
        `Last updated ${repo.updated_at.slice(0, 10)}. Stars: ${repo.stargazers_count}.`,
      ]
        .filter(Boolean)
        .join(" "),
      link: repo.html_url,
      retrievedAt,
    }));

    // Without this unit, "can I see your code?" retrieves a handful of decade-old tutorial repos and
    // nothing else, and an accurate-but-incomplete answer implies the CV projects are unevidenced.
    // The shape of the public profile is itself a citable fact. The counts and dates are computed
    // from the API response so they cannot drift; the owner's note, if any, is their own stated
    // position, recorded as a statement rather than inferred.
    const years = repos
      .map((repo) => repo.updated_at.slice(0, 4))
      .sort((a, b) => a.localeCompare(b));
    const forks = repos.filter((repo) => repo.fork).length;
    const newest = years.at(-1);
    const oldest = years.at(0);

    units.push({
      id: "github:public-footprint-scope",
      source: "github",
      unitType: "profile",
      title: "Scope and age of the public GitHub profile",
      text: [
        `The public GitHub profile for ${username} contains ${repos.length} public ${repos.length === 1 ? "repository" : "repositories"}${forks > 0 ? `, of which ${forks} ${forks === 1 ? "is a fork" : "are forks"}` : ""}.`,
        oldest && newest
          ? `They were last updated between ${oldest} and ${newest}.`
          : undefined,
        await readOwnerNote(),
        `Retrieved ${retrievedAt}.`,
      ]
        .filter(Boolean)
        .join(" "),
      link: `https://github.com/${username}`,
      retrievedAt,
    });

    return units;
  },
});
