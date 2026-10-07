import type { KnowledgeUnit } from "../models";
import type { SourceAdapter } from "./types";

const USERNAME = "JeanLoureiro";
const API_URL = `https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=updated`;

interface Repo {
  name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  fork: boolean;
  updated_at: string;
  stargazers_count: number;
}

export const githubAdapter: SourceAdapter = {
  name: "github",
  description: `Public repositories for github.com/${USERNAME} via the unauthenticated REST API`,

  async load(): Promise<KnowledgeUnit[]> {
    const response = await fetch(API_URL, {
      headers: { accept: "application/vnd.github+json", "user-agent": "ask-about-jean" },
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
    // from the API response so they cannot drift; the note about private repositories is Jean's own
    // stated position, recorded as a statement rather than inferred.
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
        `The public GitHub profile for ${USERNAME} contains ${repos.length} public ${repos.length === 1 ? "repository" : "repositories"}${forks > 0 ? `, of which ${forks} ${forks === 1 ? "is a fork" : "are forks"}` : ""}.`,
        oldest && newest
          ? `They were last updated between ${oldest} and ${newest}.`
          : undefined,
        `Their own descriptions identify most of them as course and tutorial follow-alongs. None of them corresponds to the projects described on the CV, and none demonstrates the AI or agentic engineering work the CV leads with.`,
        `The public profile is therefore a record of earlier learning work, not a representation of current capability.`,
        `The CV projects — Marketing Triage, Pohly, Financial Sanity and The Clubhouse Poker — are in private repositories, as is client work. Jean's stated position is that these can be shared on request during a hiring conversation, so the absence of a public repository for a project is not evidence against that project.`,
        `Retrieved ${retrievedAt}.`,
      ]
        .filter(Boolean)
        .join(" "),
      link: `https://github.com/${USERNAME}`,
      retrievedAt,
    });

    return units;
  },
};
