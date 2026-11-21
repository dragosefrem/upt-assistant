/** Colours and labels for each kind of calendar event, shared by server and client UI. */
const KIND_STYLE: Record<string, { block: string; dot: string; label: string }> = {
  course: { block: "border-brand-500 bg-brand-50 text-brand-900", dot: "bg-brand-500", label: "Lecture" },
  seminar: { block: "border-emerald-500 bg-emerald-50 text-emerald-900", dot: "bg-emerald-500", label: "Seminar" },
  lab: { block: "border-amber-500 bg-amber-50 text-amber-900", dot: "bg-amber-500", label: "Lab" },
  project: { block: "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-900", dot: "bg-fuchsia-500", label: "Project" },
  other: { block: "border-slate-400 bg-slate-100 text-slate-800", dot: "bg-slate-400", label: "Other" },
  exam: { block: "border-red-500 bg-red-50 text-red-900", dot: "bg-red-500", label: "Exam" },
  personal: { block: "border-violet-500 bg-violet-50 text-violet-900", dot: "bg-violet-500", label: "Personal" },
  shared: { block: "border-teal-500 bg-teal-50 text-teal-900", dot: "bg-teal-500", label: "Shared event" },
};

export function kindStyle(kind: string) {
  return KIND_STYLE[kind] ?? KIND_STYLE.other;
}
