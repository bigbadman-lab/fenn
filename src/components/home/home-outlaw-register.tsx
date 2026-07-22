import { OutlawRegisterPanel } from "@/components/outlaw/outlaw-register-panel";

export function HomeOutlawRegister() {
  return (
    <section
      id="outlaw-register"
      className="home-section home-register"
      aria-labelledby="outlaw-register-title"
    >
      <h2 id="outlaw-register-title" className="place__title">
        THE OUTLAW REGISTER
      </h2>
      <OutlawRegisterPanel embedded />
    </section>
  );
}
