import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DocumentInfo, WorkspaceNode, WorkspaceWithData } from '../sidebar/sidebar-types';

export type SourceDocument = DocumentInfo & { docId: string };
export interface LibraryFolder { key: string; title: string; documents: SourceDocument[]; children: LibraryFolder[]; ordered: SourceDocument[] }
export interface LibraryWorkspace extends LibraryFolder { filename: string }

export async function outlineRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not load this information. Try again.');
  return data as T;
}

export function useOutlineLibrary() {
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceWithData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(n => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      outlineRequest<DocumentInfo[]>('/api/documents'),
      outlineRequest<WorkspaceWithData[]>('/api/workspaces?full=1'),
    ]).then(([docs, spaces]) => {
      if (cancelled) return;
      const unique = new Map<string, SourceDocument>();
      docs.forEach(d => { if (d.docId && !unique.has(d.docId)) unique.set(d.docId, d as SourceDocument); });
      setDocuments([...unique.values()]); setWorkspaces(spaces); setLoaded(true); setError('');
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [tick]);
  useEffect(() => {
    window.addEventListener('ow-documents-changed', reload);
    return () => window.removeEventListener('ow-documents-changed', reload);
  }, [reload]);
  const projection = useMemo(() => {
    const byId = new Map(documents.map(d => [d.docId, d]));
    const byFile = new Map(documents.map(d => [d.filename, d]));
    const contexts = new Map<string, string[]>();
    const assigned = new Set<string>();
    const build = (nodes: WorkspaceNode[], key: string, title: string, path: string): LibraryFolder => {
      const folder: LibraryFolder = { key, title, documents: [], children: [], ordered: [] };
      for (const node of nodes) {
        if (node.type === 'container') {
          const child = build(node.items, `${key}/${node.id}`, node.name, `${path} / ${node.name}`);
          folder.children.push(child); folder.ordered.push(...child.ordered);
        }
        else {
          const doc = byFile.get(node.file);
          if (doc) {
            if (!folder.documents.some(d => d.docId === doc.docId)) folder.documents.push(doc);
            folder.ordered.push(doc); assigned.add(doc.docId);
            contexts.set(doc.docId, [...(contexts.get(doc.docId) || []), path]);
          }
          if (node.children?.length) {
            const child = build(node.children, `${key}/${node.file}`, node.title, `${path} / ${node.title}`);
            folder.children.push(child); folder.ordered.push(...child.ordered);
          }
        }
      }
      return folder;
    };
    const tree: LibraryWorkspace[] = workspaces.map(w => ({ ...build(w.workspace?.root || [], w.filename, w.title, w.title), filename: w.filename }));
    const unfiled = documents.filter(d => !assigned.has(d.docId));
    tree.push({ key: 'unfiled', filename: 'unfiled', title: 'Unfiled documents', documents: unfiled, children: [], ordered: unfiled });
    return { byId, contexts, tree };
  }, [documents, workspaces]);
  return { documents, ...projection, loaded, error, reload };
}

export type OutlineLibrary = ReturnType<typeof useOutlineLibrary>;
