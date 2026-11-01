export type CountryCode = "japan" | "korea" | "china" | "india" | "usa";

export interface Country {
  code: CountryCode;
  label: string;
}
