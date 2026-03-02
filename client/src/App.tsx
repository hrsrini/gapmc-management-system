import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import RentInvoiceList from "@/pages/rent/RentInvoiceList";
import RentInvoiceForm from "@/pages/rent/RentInvoiceForm";
import RentInvoiceEditPage from "@/pages/rent/RentInvoiceEditPage";
import RentReports from "@/pages/rent/RentReports";
import TraderList from "@/pages/traders/TraderList";
import TraderForm from "@/pages/traders/TraderForm";
import TraderEditPage from "@/pages/traders/TraderEditPage";
import TraderAgreements from "@/pages/traders/TraderAgreements";
import FeeCollection from "@/pages/market-fee/FeeCollection";
import ImportExport from "@/pages/market-fee/ImportExport";
import Returns from "@/pages/market-fee/Returns";
import ReceiptList from "@/pages/receipts/ReceiptList";
import ReceiptForm from "@/pages/receipts/ReceiptForm";
import LedgerReports from "@/pages/receipts/LedgerReports";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/dashboard">
        <ProtectedRoute><Dashboard /></ProtectedRoute>
      </Route>
      <Route path="/rent">
        <ProtectedRoute><RentInvoiceList /></ProtectedRoute>
      </Route>
      <Route path="/rent/new">
        <ProtectedRoute><RentInvoiceForm /></ProtectedRoute>
      </Route>
      <Route path="/rent/edit/:id">
        <ProtectedRoute><RentInvoiceEditPage /></ProtectedRoute>
      </Route>
      <Route path="/rent/reports">
        <ProtectedRoute><RentReports /></ProtectedRoute>
      </Route>
      <Route path="/traders">
        <ProtectedRoute><TraderList /></ProtectedRoute>
      </Route>
      <Route path="/traders/new">
        <ProtectedRoute><TraderForm /></ProtectedRoute>
      </Route>
      <Route path="/traders/edit/:id">
        <ProtectedRoute><TraderEditPage /></ProtectedRoute>
      </Route>
      <Route path="/traders/agreements">
        <ProtectedRoute><TraderAgreements /></ProtectedRoute>
      </Route>
      <Route path="/market-fee">
        <ProtectedRoute><FeeCollection /></ProtectedRoute>
      </Route>
      <Route path="/market-fee/entry">
        <ProtectedRoute><ImportExport /></ProtectedRoute>
      </Route>
      <Route path="/market-fee/returns">
        <ProtectedRoute><Returns /></ProtectedRoute>
      </Route>
      <Route path="/receipts">
        <ProtectedRoute><ReceiptList /></ProtectedRoute>
      </Route>
      <Route path="/receipts/new">
        <ProtectedRoute><ReceiptForm /></ProtectedRoute>
      </Route>
      <Route path="/receipts/ledger">
        <ProtectedRoute><LedgerReports /></ProtectedRoute>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
