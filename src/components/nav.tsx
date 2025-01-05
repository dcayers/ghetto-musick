"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@nextui-org/react";
import { Layout, ListMusic, Map } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  {
    name: "Genres",
    href: "/music/genres",
    icon: Layout,
  },
  {
    name: "Connections",
    href: "/music/connections",
    icon: Map,
  },
  {
    name: "Setlists",
    href: "/music/set-lists",
    icon: ListMusic,
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="flex border-b bg-background px-4 py-2">
      <div className="flex items-center gap-4">
        {navigation.map((item) => (
          <Button
            key={item.name}
            variant="light"
            as={Link}
            className={cn("gap-2", pathname === item.href && "bg-muted")}
            href={item.href}
            startContent={<item.icon size={20} />}
          >
            {item.name}
          </Button>
        ))}
      </div>
    </nav>
  );
}
