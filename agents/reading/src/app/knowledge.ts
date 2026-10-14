import {canonicalJson,sha256} from '../contracts/index.js';
import {indexNote,recallNotes,heldoutNote,type NoteIndex} from '../context/index.js';
import type {HostProject} from './controller.js';
import type {WorkspaceJournal} from './journal.js';
/** Default branch and actual pending PR notes are authoritative; merged workspace drafts are historical only. */
export async function currentKnowledgeView(records:WorkspaceJournal,project:HostProject,currentIndex:NoteIndex[],heldout:{urls:Set<string>;note_paths:Set<string>},relatedViews:Map<string,NoteIndex>=new Map()) {
  const query = `${project.candidate.title ?? ""} ${project.candidate.url} ${project.selection?.reason ?? ""}`;
    const recalled = recallNotes(currentIndex, query, heldout);
    for (const note of recalled) relatedViews.set(note.id, note);
    const selected = recalled.map((note) => ({
      id: note.id,
      title: note.title,
      summary: note.summary,
      source_urls: note.sources,
      path: note.path,
      commit: note.commit,
      hash: note.hash,
      pending: note.pending,
    }));
    const terms = new Set(
      query.toLowerCase().match(/[a-z0-9_-]{2,}|[\u3400-\u9fff]{2,}/g) ?? [],
    );
    const projects: {
      id: string;
      title: string;
      summary: string;
      source_urls: string[];
      pending: boolean;
      score: number;
      path?: string;
      commit?: string;
      hash?: string;
    }[] = [];
    for (const key of records.keys("projects/")) {
      const current = await records.load<HostProject>(key);
      if (
        !current ||
        current.project_id === project.project_id ||
        ["skipped", "closed_unmerged", "merged"].includes(current.state) ||
        (!!current.writing&&currentIndex.some(note=>note.pending&&note.path===current.writing!.note_path)) ||
        heldoutNote({path:current.writing?.note_path??'',sources:[current.candidate.url,...current.candidate.aliases]},heldout) ||
        (!!current.writing && heldout.note_paths.has(current.writing.note_path))
      )
        continue;
      const summary = [
        current.selection?.reason,
        current.research?.knowledge_increment,
        current.writing?.markdown.replace(/```[\s\S]*?```/g, "").slice(0, 600),
      ]
        .filter(Boolean)
        .join("\n");
      const text = `${current.candidate.title ?? ""} ${summary}`.toLowerCase();
      const score = [...terms].filter((term) => text.includes(term)).length;
      if (summary && score > 0) {
        const artifact = current.writing
          ? records.handle.snapshot.manifest.files.find(
              (file) =>
                file.path ===
                `projects/${current.project_id}/draft/${current.writing!.note_path}`,
            )
          : undefined;
        let version: { path: string; commit: string; hash: string } | undefined;
        if (
          current.writing &&
          artifact?.sha256 === sha256(current.writing.markdown)
        ) {
          const snapshot = indexNote({
            path: current.writing.note_path,
            commit: records.handle.revision,
            text: current.writing.markdown,
            first_added_at: current.created_at,
            pending: current.state !== "merged",
          });
          snapshot.id = current.project_id;
          relatedViews.set(snapshot.id, snapshot);
          version = {
            path: snapshot.path,
            commit: snapshot.commit,
            hash: snapshot.hash,
          };
        }
        projects.push({
          id: current.project_id,
          title: current.candidate.title ?? current.project_id,
          summary: summary.slice(0, 1000),
          source_urls: [current.candidate.url],
          pending: current.state !== "merged",
          score,
          ...version,
        });
      }
    }
    const view = [
      ...selected,
      ...projects
        .sort((a, b) => b.score - a.score)
        .map(({ score, ...note }) => note),
    ].slice(0, 12);
    const snapshot = {
      project_id: project.project_id,
      query,
      notes: view,
      observed_at: new Date().toISOString(),
    };
    await records.commit(
      `knowledge-views/${sha256(canonicalJson(snapshot))}`,
      snapshot,
    );
    return view;
}
