import { formatMinutes } from "../time";
import type { CardEvent, ReplyCard } from "./reply-card";

/** Short spoken answers refer to the options in the order they appeared. */
export function optionIndex(message: string): number | undefined {
  const text = message.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim()
    .replace(/[.!?]+$/, "").replace(/^(?:the |option |varianta |optiunea |pe )/, "").replace(/ (?:one|option)$/, "");
  const options = [["1", "one", "first", "prima", "primul"], ["2", "two", "second", "a doua", "al doilea"],
    ["3", "three", "third", "a treia", "al treilea"], ["4", "fourth", "a patra", "al patrulea"],
    ["5", "fifth", "a cincea", "al cincilea"], ["6", "sixth", "a sasea", "al saselea"]];
  const i = options.findIndex((names) => names.includes(text));
  return i < 0 ? undefined : i;
}

export function eventEditorTime(row: CardEvent, destination?: Extract<ReplyCard, { type: "move" }>["proposed"]) {
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = destination?.start ?? row.start;
  const duration = row.end ? minutes(row.end) - minutes(row.start) : 60;
  const end = minutes(start) + duration;
  return { date: destination?.date ?? row.date, start, end: destination?.end ?? (end <= 1440 ? formatMinutes(end) : "") };
}
