import { Nav } from "@/components/nav";
import { ProtectedProviders } from "@/components/providers";

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex h-screen flex-col">
      <Nav />
      <main className="flex-1 overflow-hidden">
        <ProtectedProviders>{children}</ProtectedProviders>
      </main>
    </div>
  );
}
