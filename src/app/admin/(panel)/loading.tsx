import { AdaptiveSkeleton } from "@/components/admin/AdaptiveSkeleton";

// Instant loading state for every page in this app: the skeleton adapts to the route being opened.
export default function Loading() {
  return <AdaptiveSkeleton />;
}
