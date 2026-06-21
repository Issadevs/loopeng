import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import TheShift from "@/components/TheShift";
import InstallFlow from "@/components/InstallFlow";
import HowItWorks from "@/components/HowItWorks";
import ToolAnatomy from "@/components/ToolAnatomy";
import Dashboard from "@/components/Dashboard";
import Operate from "@/components/Operate";
import Privacy from "@/components/Privacy";
import Fable from "@/components/Fable";
import Impact from "@/components/Impact";
import NeverGuilt from "@/components/NeverGuilt";
import Faq from "@/components/Faq";
import Cta from "@/components/Cta";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <TheShift />
        <InstallFlow />
        <HowItWorks />
        <ToolAnatomy />
        <Dashboard />
        <Operate />
        <Privacy />
        <Fable />
        <Impact />
        <NeverGuilt />
        <Faq />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
