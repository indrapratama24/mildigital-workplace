// Shared by server pages and the client form (plain module — not "use client").
import type { ClientStatusT } from "@/lib/engine/clients";

export interface ClientFormValues {
  clientCode: string;
  name: string;
  organizationName: string;
  status: ClientStatusT;
  dateStart: string;
  dateOff: string;
  packageId: string;
  primary: string;
  secondary: string;
  additional: string[];
  adsStrategists: string[];
  waivePrimary: boolean;
  waiverReason: string;
  industry: string;
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  picName: string;
  picContact: string;
  internalNotes: string;
}

export const EMPTY_CLIENT: ClientFormValues = {
  clientCode: "",
  name: "",
  organizationName: "",
  status: "ACTIVE",
  dateStart: "",
  dateOff: "",
  packageId: "",
  primary: "",
  secondary: "",
  additional: [],
  adsStrategists: [],
  waivePrimary: false,
  waiverReason: "",
  industry: "",
  description: "",
  websiteUrl: "",
  instagramUrl: "",
  tiktokUrl: "",
  picName: "",
  picContact: "",
  internalNotes: "",
};
