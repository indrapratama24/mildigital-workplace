// Extension point for future attendance providers (badge readers, HRIS, office Wi-Fi check-in, etc).
// The initial release uses manual self clock-in only — no continuous location tracking.
import type { ISODate } from "@/lib/dates";

export interface ProviderAttendanceRecord {
  employeeEmail: string;
  date: ISODate;
  mode: "WFO" | "WFH" | "OFFSITE";
  clockInAt: Date;
  /** Whether the provider's record is authoritative enough to count as verified attendance. */
  verified: boolean;
  externalId: string;
}

export interface AttendanceProvider {
  readonly name: string;
  fetchRecords(from: ISODate, to: ISODate): Promise<ProviderAttendanceRecord[]>;
}

/** Default: no external provider configured. */
export const manualOnlyProvider: AttendanceProvider = {
  name: "manual",
  fetchRecords: async () => [],
};

export function getAttendanceProvider(): AttendanceProvider {
  return manualOnlyProvider;
}
