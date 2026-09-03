import { PortalSidebar } from "@/components/app/PortalSidebar";
import styles from "../portal.module.css";

export default function PortalShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <PortalSidebar />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
