import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { IncidentProvider } from "./store/incidentStore";
import { ClockProvider } from "./lib/clock";
import "./styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <IncidentProvider>
        <ClockProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ClockProvider>
      </IncidentProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
