import { plural } from "../config";

const en = {
  title: "Notifications",
  unread: (n: number) => `Notifications, ${n} new`,
  requests: "Needs a reply",
  upcoming: "Coming up",
  horizon: "Today and tomorrow, plus exams in the next 30 days.",
  empty: "You’re all caught up.",
  contact: "Contact request",
  contactFrom: (name: string) => `${name} wants to add you as a contact`,
  review: "Review request",
  invitation: "Event invitation",
  invitedBy: (name: string) => `Invited by ${name}`,
  device: "Notify me on this device",
  timings: "While Poli is open, get invitations and a heads-up 15 minutes before classes and plans. Exam alerts come a week, a day, 2 hours and 30 minutes before.",
  blocked: "Allow notifications in your browser’s site settings to see them on this device.",
  unsupported: "Device notifications are unavailable in this browser.",
  deviceFailed: "Your browser couldn’t show a device notification.",
  testTitle: "Poli notifications are on",
  testBody: "You’ll receive invitations and reminders while Poli is open.",
  export: "Get reminders in your calendar when Poli is closed",
};

const ro: typeof en = {
  title: "Notificări",
  unread: (n: number) => `Notificări, ${plural("ro", n, { one: "una nouă", few: `${n} noi`, other: `${n} de noi` })}`,
  requests: "Așteaptă răspunsul tău",
  upcoming: "Urmează",
  horizon: "Ce ai în program azi și mâine, plus examenele din următoarele 30 de zile.",
  empty: "Ești la zi.",
  contact: "Cerere de contact",
  contactFrom: (name: string) => `${name} vrea să te adauge în contacte`,
  review: "Vezi cererea",
  invitation: "Invitație la eveniment",
  invitedBy: (name: string) => `Invitație de la ${name}`,
  device: "Anunță-mă pe acest dispozitiv",
  timings: "Cât timp Poli e deschis, primești invitații și un semn cu 15 minute înainte de ore și de evenimente. Pentru examene, Poli te anunță cu o săptămână, o zi, 2 ore și 30 de minute înainte.",
  blocked: "Permite notificările în setările site-ului din browser ca să le primești pe acest dispozitiv.",
  unsupported: "Acest browser nu poate afișa notificări pe dispozitiv.",
  deviceFailed: "Browserul nu a putut afișa notificarea pe dispozitiv.",
  testTitle: "Ai activat notificările Poli",
  testBody: "Vei primi invitații și notificări cât timp Poli e deschis.",
  export: "Primește notificări în calendar și când Poli e închis",
};

export const notifications = { en, ro };
