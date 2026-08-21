export type PalestinianCity = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

export const PALESTINIAN_CITIES: PalestinianCity[] = [
  { id: "gaza", name: "غزة", latitude: 31.5017, longitude: 34.4668 },
  { id: "ramallah", name: "رام الله", latitude: 31.9038, longitude: 35.2034 },
  { id: "nablus", name: "نابلس", latitude: 32.2211, longitude: 35.2544 },
  { id: "hebron", name: "الخليل", latitude: 31.5326, longitude: 35.0998 },
  { id: "jenin", name: "جنين", latitude: 32.4595, longitude: 35.3009 },
  { id: "tulkarm", name: "طولكرم", latitude: 32.3104, longitude: 35.0286 },
  { id: "jericho", name: "أريحا", latitude: 31.8572, longitude: 35.4444 },
  { id: "bethlehem", name: "بيت لحم", latitude: 31.7054, longitude: 35.2024 },
  { id: "jerusalem", name: "القدس", latitude: 31.7683, longitude: 35.2137 },
  { id: "rafah", name: "رفح", latitude: 31.2969, longitude: 34.2436 },
  { id: "khan-younis", name: "خان يونس", latitude: 31.3460, longitude: 34.3063 },
  { id: "deir-al-balah", name: "دير البلح", latitude: 31.4181, longitude: 34.3493 },
  { id: "qalqilya", name: "قلقيلية", latitude: 32.1897, longitude: 34.9706 },
  { id: "salfit", name: "سلفيت", latitude: 32.0837, longitude: 35.1808 },
  { id: "tubas", name: "طوباس", latitude: 32.3209, longitude: 35.3699 },
];
