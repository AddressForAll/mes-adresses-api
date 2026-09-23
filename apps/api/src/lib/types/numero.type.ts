export type NumeroInBbox = {
  id: string;
  numero: number | null;
  numeroTexte: string | null;
  numeroComplet: string;
  suffixe: string;
  postalCode: string | null;
  parcelles: string[];
  certifie: string;
  voieId: string;
  toponymeId: string;
  point: { type: string; coordinates: number[][] };
};
