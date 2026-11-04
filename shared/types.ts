// Форма данных API. Сервер на Python (server/app/plans.py) отдаёт ровно эти поля.

export type Format = 'eat' | 'coffee' | 'bar' | 'active' | 'walk' | 'home' | 'any';
/** Бюджет на человека: '1' — до 100 тыс сум, '2' — до 250 тыс, '3' — до 500 тыс. */
export type Budget = '1' | '2' | '3' | 'any';
export type Duration = '1-2' | '2-3' | 'evening';
export type MemberStatus = 'go' | 'maybe' | 'no';
/** 1 — удобно, 2 — если надо. Отсутствие ключа — не могу. */
export type SlotValue = 1 | 2;
export type PlanStatus = 'collecting' | 'confirmed' | 'done';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Me {
  id: number;
  name: string;
}

/** Своё место: название, ссылка и точка на карте. */
export interface NewPlace {
  name: string;
  url: string | null;
  lat: number | null;
  lng: number | null;
}

export interface NewPlan {
  title: string;
  format: Format;
  budget: Budget;
  duration: Duration;
  votePlace: boolean;
  middle: boolean;
  /** Дни в формате YYYY-MM-DD. */
  days: string[];
  /** Время начала слотов в формате HH:mm. */
  times: string[];
  deadlineHours: number | null;
  /** Заполнено, если организатор сразу выбрал место из каталога. */
  placeId: string | null;
  /** Своё место организатора. Обязательно, если нет ни голосования, ни поиска середины. */
  place?: NewPlace | null;
}

export interface Member {
  id: number;
  name: string;
  status: MemberStatus | null;
  isOwner: boolean;
}

export interface SlotStat {
  /** `${date}T${time}` */
  key: string;
  date: string;
  time: string;
  good: number;
  maybe: number;
  missing: string[];
  maybeNames: string[];
}

export interface PlaceView {
  id: string;
  name: string;
  kind: string;
  /** Средний чек на человека, сум. null — неизвестен (свои места). */
  avgCheck: number | null;
  rating: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  promo: string | null;
  partner: boolean;
  custom: boolean;
  votes: number;
  liked: boolean;
  travel: string | null;
}

export interface Review {
  happened: boolean;
  rating: number | null;
  tags: string[];
}

export interface Bill {
  total: number;
  payerId: number;
  paid: number[];
}

export interface MyAnswer {
  id: number;
  status: MemberStatus | null;
  slots: Record<string, SlotValue>;
  area: LatLng | null;
  remind: boolean;
  review: Review | null;
}

export interface PlanView {
  id: string;
  title: string;
  format: Format;
  budget: Budget;
  duration: Duration;
  votePlace: boolean;
  middle: boolean;
  /** Место, которое организатор выбрал при создании или при подтверждении. */
  placeId: string | null;
  status: PlanStatus;
  deadline: string | null;
  isOwner: boolean;
  ownerName: string;
  days: string[];
  times: string[];
  members: Member[];
  me: MyAnswer;
  /** Примерные районы участников (округлены до ~1 км). */
  areas: (LatLng & { name: string })[];
  /** Сколько человек свободно в слот: удобно + если надо. */
  heat: Record<string, number>;
  responded: number;
  top: SlotStat[];
  places: PlaceView[];
  center: LatLng | null;
  chosen: { date: string; time: string; placeId: string | null } | null;
  bill: Bill | null;
}

export interface PlanSummary {
  id: string;
  title: string;
  status: PlanStatus;
  isOwner: boolean;
  needsAnswer: boolean;
  deadline: string | null;
  chosen: { date: string; time: string } | null;
  placeName: string | null;
  going: string[];
  responded: number;
}

export interface MePatch {
  status?: MemberStatus;
  slots?: Record<string, SlotValue>;
  area?: LatLng | null;
  remind?: boolean;
}
