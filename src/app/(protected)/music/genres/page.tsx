import { GenresView } from "@/components/views/genres-view";
import { mockGenres } from "@/lib/mock-data";

export default function Genres() {
  return <GenresView data={mockGenres} />;
}
