export type RushLevel = 'light' | 'medium' | 'heavy';
export type RoadType = 'highway' | 'arterial' | 'local';
export type Pt = [number, number];
export interface Road { id: string; name: string; type: RoadType; segments: Pt[][]; lengthM: number; center: Pt; }
export interface SelectedTime { day: number; hour: number; minute: number; } // day 0=Sun..6=Sat
export interface HourPoint { hour: number; score: number; level: RushLevel; }
export interface Prediction { roadId: string; nowScore: number; nowLevel: RushLevel;
  jamChanceNextHour: number; hourly: HourPoint[]; } // hourly = 24 entries for the selected day
export interface RouteResult { roadIds: string[]; path: Pt[]; distanceKm: number; minutes: number;
  jamChance: number; minutesSaved: number; }
export interface CameraFeed { id: string; name: string; roadId: string; position: Pt; videoSrc: string; }
