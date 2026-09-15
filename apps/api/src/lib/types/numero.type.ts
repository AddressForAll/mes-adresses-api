export type NumeroInBbox = {
  id: string;
  numero: number | null;
  numeroTexte: string | null;
  numeroComplet: string;
  suffixe: string;
  parcelles: string[];
  certifie: string;
  voieId: string;
  toponymeId: string;
  point: { type: string; coordinates: number[][] };
};
