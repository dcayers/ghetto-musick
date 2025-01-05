import { ConnectionsView } from "@/components/views/connections-view";
import { mockGenres, mockConnections } from "@/lib/mock-data";

export default function Connections() {
  return <ConnectionsView data={mockGenres} connections={mockConnections} />;
}
