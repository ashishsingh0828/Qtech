const listeners = new Set();
let current = { datasetId: "", groups: [] };

export function publishSheet(datasetId, groups) {
  current = {
    datasetId: String(datasetId || ""),
    groups: (groups || []).map((group) => ({
      groupKey: group.groupKey || "",
      label: group.label || group.groupKey || "Group",
    })),
  };
  listeners.forEach((listener) => listener(current));
}

export function currentSheet() {
  return current;
}

export function subscribeSheet(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
