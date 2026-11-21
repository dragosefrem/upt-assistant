/**
 * Friendly, practical suggestions from Poli for an upcoming exam. Pure functions, so
 * the same wording is used on the home page, the exams page and in notifications.
 */

export type ExamStage = "later" | "week" | "soon" | "tomorrow" | "today" | "now";

/** How close an exam is, from the whole days left and the minutes until it starts. */
export function examStage(daysLeft: number, minutesUntil: number): ExamStage {
  if (minutesUntil <= 0) return "now";
  if (daysLeft <= 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft <= 3) return "soon";
  if (daysLeft <= 7) return "week";
  return "later";
}

/** "in 3 days", "tomorrow", "in 2 h 15 min", "now". */
export function countdown(daysLeft: number, minutesUntil: number): string {
  if (minutesUntil <= 0) return "now";
  if (daysLeft <= 0) {
    if (minutesUntil < 60) return `in ${minutesUntil} min`;
    const h = Math.floor(minutesUntil / 60);
    const m = minutesUntil % 60;
    return `in ${h} h${m ? ` ${m} min` : ""}`;
  }
  if (daysLeft === 1) return "tomorrow";
  return `in ${daysLeft} days`;
}

export interface TipInput {
  course: string;
  daysLeft: number;
  minutesUntil: number;
  startTime: string;
  room: string | null;
  building: string | null;
  /** Minutes the trip takes from the student's position, when known. */
  travelMinutes?: number | null;
}

/** Where to go, in one short phrase: "room A101 (Mechanical Engineering building)". */
export function whereTo(room: string | null, building: string | null): string {
  if (room && building) return `room ${room} (${building})`;
  if (room) return `room ${room}`;
  if (building) return building;
  return "the room on the exam list";
}

/** The headline Poli says for an exam at this stage. */
export function examHeadline({ course, daysLeft, minutesUntil, startTime, room, building }: TipInput): string {
  const where = whereTo(room, building);
  switch (examStage(daysLeft, minutesUntil)) {
    case "now":
      return `${course} is starting now in ${where}. Good luck! 🍀`;
    case "today":
      return `${course} exam today at ${startTime}, ${where}. You've got this! 💪`;
    case "tomorrow":
      return `${course} exam tomorrow at ${startTime}, ${where}.`;
    case "soon":
      return `${course} exam in ${daysLeft} days, ${where}.`;
    case "week":
      return `${course} exam next week: ${daysLeft} days to go.`;
    default:
      return `${course} exam in ${daysLeft} days. Plenty of time to plan.`;
  }
}

/** Two or three concrete suggestions that fit how close the exam is. */
export function examTips(input: TipInput): string[] {
  const { daysLeft, minutesUntil, startTime, room, building, travelMinutes } = input;
  const where = whereTo(room, building);
  switch (examStage(daysLeft, minutesUntil)) {
    case "now":
      return ["Breathe, read every question once before you start, and do the easy ones first."];
    case "today": {
      const [h, m] = startTime.split(":").map(Number);
      const arrive = h * 60 + m - 15;
      const by = arrive >= 0 ? `${String(Math.floor(arrive / 60)).padStart(2, "0")}:${String(arrive % 60).padStart(2, "0")}` : startTime;
      const leave = travelMinutes
        ? `Leave about ${travelMinutes + 15} minutes before ${startTime} to reach ${where} with time to spare.`
        : `Be at ${where} by ${by}, 15 minutes before it starts.`;
      return [leave, "Pack your student ID, pens and anything the teacher allowed (calculator, formula sheet).", "Eat something and bring water. A calm brain works better. 🥤"];
    }
    case "tomorrow":
      return [
        "Do one light review of your summary notes. No new chapters tonight.",
        `Check how to get to ${where} and set an alarm with a buffer.`,
        "Sleep at least 7 hours; it helps memory more than a late-night cram. 😴",
      ];
    case "soon":
      return [
        "Solve a past exam or a mock test under time pressure.",
        "Write down what you still don't get and ask a colleague or the teacher.",
        "Study in 25-minute blocks with 5-minute breaks to stay fresh.",
      ];
    case "week":
      return [
        "Split the material into one chunk per day until the exam.",
        "Make a one-page summary of formulas and key ideas.",
        "Join or start a study group: explaining something is the best test.",
      ];
    default:
      return ["Put the exam in your calendar and plan when to start reviewing.", "A little each week beats everything in the last three days. 📚"];
  }
}

/** Gentle tips for days without exams coming up. One is picked by the day of the year. */
export const EVERYDAY_TIPS = [
  "Take a 5-minute break every 25 minutes of study. Your focus will thank you. ⏱️",
  "Drink some water and stretch. Long hours at the desk add up. 💧",
  "Review today's lecture notes for 10 minutes tonight. It saves hours before exams.",
  "Plan tomorrow in two minutes: classes, rooms, and one thing you want to get done. ✅",
  "Get some fresh air between classes. A short walk resets your head. 🌳",
  "Ask questions in the seminar. Someone else is probably wondering the same thing. 🙋",
];

export function everydayTip(date: string): string {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return EVERYDAY_TIPS[((day % EVERYDAY_TIPS.length) + EVERYDAY_TIPS.length) % EVERYDAY_TIPS.length];
}
