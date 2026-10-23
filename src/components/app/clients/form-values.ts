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
  /** Ad accounts (names) each Ads Strategist handles, keyed by employee id. */
  asAdAccounts: Record<string, string[]>;
  waivePrimary: boolean;
  waiverReason: string;
  categoryId: string;
  industryName: string;
  subIndustryName: string;
  adAccounts: string[];
  description: string;
  websiteUrl: string;
  instagramUrl: string;
  tiktokUrl: string;
  picName: string;
  picPhone: string;
  picEmail: string;
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
  asAdAccounts: {},
  waivePrimary: false,
  waiverReason: "",
  categoryId: "",
  industryName: "",
  subIndustryName: "",
  adAccounts: [],
  description: "",
  websiteUrl: "",
  instagramUrl: "",
  tiktokUrl: "",
  picName: "",
  picPhone: "",
  picEmail: "",
  internalNotes: "",
};

export interface TaxonomyOptions {
  categories: { id: string; name: string; isActive: boolean }[];
  industries: { id: string; name: string; categoryId: string | null; subIndustries: { id: string; name: string }[] }[];
  adAccounts: { id: string; name: string; isActive: boolean }[];
}
