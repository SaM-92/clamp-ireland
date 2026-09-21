export interface PendingReport {
  id: string;
  locationId: string;
  reporterType: string;
  description: string;
  imageUrl: string | null;
  createdAt: string;
}
