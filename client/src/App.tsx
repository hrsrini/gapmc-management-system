import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/context/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { RequirePermission } from "@/components/RequirePermission";
import { Auth403Listener } from "@/components/Auth403Listener";

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
import IomsReceiptList from "@/pages/receipts/IomsReceiptList";
import IomsReceiptDetail from "@/pages/receipts/IomsReceiptDetail";
import IomsReceiptReconciliation from "@/pages/receipts/IomsReceiptReconciliation";
import VerifyReceipt from "@/pages/VerifyReceipt";
import Health from "@/pages/Health";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminRoles from "@/pages/admin/AdminRoles";
import AdminLocations from "@/pages/admin/AdminLocations";
import AdminConfig from "@/pages/admin/AdminConfig";
import AdminAudit from "@/pages/admin/AdminAudit";
import AdminPermissionMatrix from "@/pages/admin/AdminPermissionMatrix";
import AdminSlaConfig from "@/pages/admin/AdminSlaConfig";
import HrEmployees from "@/pages/hr/HrEmployees";
import HrEmployeeDetail from "@/pages/hr/HrEmployeeDetail";
import HrEmployeeForm from "@/pages/hr/HrEmployeeForm";
import HrRecruitment from "@/pages/hr/HrRecruitment";
import LeaveRequests from "@/pages/hr/LeaveRequests";
import HrClaims from "@/pages/hr/HrClaims";
import HrAttendance from "@/pages/hr/HrAttendance";
import HrTimesheets from "@/pages/hr/HrTimesheets";
import TraderLicences from "@/pages/traders/TraderLicences";
import TraderLicenceDetail from "@/pages/traders/TraderLicenceDetail";
import TraderBlockingLog from "@/pages/traders/TraderBlockingLog";
import AssetList from "@/pages/assets/AssetList";
import AssetsVacant from "@/pages/assets/AssetsVacant";
import AssetAllotments from "@/pages/assets/AssetAllotments";
import IomsRentInvoices from "@/pages/rent/IomsRentInvoices";
import IomsRentInvoiceDetail from "@/pages/rent/IomsRentInvoiceDetail";
import IomsRentInvoiceForm from "@/pages/rent/IomsRentInvoiceForm";
import IomsCreditNotes from "@/pages/rent/IomsCreditNotes";
import RentLedger from "@/pages/rent/RentLedger";
import CommoditiesList from "@/pages/market/CommoditiesList";
import MarketTransactions from "@/pages/market/MarketTransactions";
import FeeRatesList from "@/pages/market/FeeRatesList";
import FarmersList from "@/pages/market/FarmersList";
import MspSettingsList from "@/pages/market/MspSettingsList";
import CheckPostInward from "@/pages/checkpost/CheckPostInward";
import CheckPostOutward from "@/pages/checkpost/CheckPostOutward";
import ExitPermitsList from "@/pages/checkpost/ExitPermitsList";
import BankDepositsList from "@/pages/checkpost/BankDepositsList";
import VouchersList from "@/pages/vouchers/VouchersList";
import VoucherCreate from "@/pages/vouchers/VoucherCreate";
import VoucherDetail from "@/pages/vouchers/VoucherDetail";
import VouchersAdvances from "@/pages/vouchers/VouchersAdvances";
import FleetVehicles from "@/pages/fleet/FleetVehicles";
import FleetVehicleForm from "@/pages/fleet/FleetVehicleForm";
import FleetVehicleDetail from "@/pages/fleet/FleetVehicleDetail";
import ConstructionWorks from "@/pages/construction/ConstructionWorks";
import WorkForm from "@/pages/construction/WorkForm";
import WorkDetail from "@/pages/construction/WorkDetail";
import ConstructionAmc from "@/pages/construction/ConstructionAmc";
import ConstructionLandRecords from "@/pages/construction/ConstructionLandRecords";
import ConstructionFixedAssets from "@/pages/construction/ConstructionFixedAssets";
import DakInward from "@/pages/correspondence/DakInward";
import DakInwardForm from "@/pages/correspondence/DakInwardForm";
import DakInwardDetail from "@/pages/correspondence/DakInwardDetail";
import DakOutward from "@/pages/correspondence/DakOutward";
import DakOutwardForm from "@/pages/correspondence/DakOutwardForm";
import AccessDenied from "@/pages/AccessDenied";
import IomsReports from "@/pages/reports/IomsReports";
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
        <ProtectedRoute><RequirePermission module="M-03" action="Create"><RentInvoiceForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/rent/edit/:id">
        <ProtectedRoute><RequirePermission module="M-03" action="Update"><RentInvoiceEditPage /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/rent/reports">
        <ProtectedRoute><RentReports /></ProtectedRoute>
      </Route>
      <Route path="/rent/ioms">
        <ProtectedRoute><IomsRentInvoices /></ProtectedRoute>
      </Route>
      <Route path="/rent/ioms/invoices/new">
        <ProtectedRoute><RequirePermission module="M-03" action="Create"><IomsRentInvoiceForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/rent/ioms/invoices/:id">
        <ProtectedRoute><IomsRentInvoiceDetail /></ProtectedRoute>
      </Route>
      <Route path="/rent/ioms/ledger">
        <ProtectedRoute><RentLedger /></ProtectedRoute>
      </Route>
      <Route path="/rent/ioms/credit-notes">
        <ProtectedRoute><IomsCreditNotes /></ProtectedRoute>
      </Route>
      <Route path="/traders">
        <ProtectedRoute><TraderList /></ProtectedRoute>
      </Route>
      <Route path="/traders/new">
        <ProtectedRoute><RequirePermission module="M-02" action="Create"><TraderForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/traders/edit/:id">
        <ProtectedRoute><RequirePermission module="M-02" action="Update"><TraderEditPage /></RequirePermission></ProtectedRoute>
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
      <Route path="/market/commodities">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><CommoditiesList /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/market/transactions">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><MarketTransactions /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/market/fee-rates">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><FeeRatesList /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/market/farmers">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><FarmersList /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/market/msp">
        <ProtectedRoute><MspSettingsList /></ProtectedRoute>
      </Route>
      <Route path="/checkpost/inward">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><CheckPostInward /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/checkpost/outward">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><CheckPostOutward /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/checkpost/exit-permits">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><ExitPermitsList /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/checkpost/bank-deposits">
        <ProtectedRoute><RequirePermission module="M-04" action="Read"><BankDepositsList /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/vouchers">
        <ProtectedRoute><VouchersList /></ProtectedRoute>
      </Route>
      <Route path="/vouchers/advances">
        <ProtectedRoute><VouchersAdvances /></ProtectedRoute>
      </Route>
      <Route path="/vouchers/create">
        <ProtectedRoute><RequirePermission module="M-06" action="Create"><VoucherCreate /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/vouchers/:id">
        <ProtectedRoute><VoucherDetail /></ProtectedRoute>
      </Route>
      <Route path="/fleet">
        <ProtectedRoute><FleetVehicles /></ProtectedRoute>
      </Route>
      <Route path="/fleet/vehicles/new">
        <ProtectedRoute><RequirePermission module="M-07" action="Create"><FleetVehicleForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/fleet/vehicles/:id/edit">
        <ProtectedRoute><RequirePermission module="M-07" action="Update"><FleetVehicleForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/fleet/vehicles/:id">
        <ProtectedRoute><FleetVehicleDetail /></ProtectedRoute>
      </Route>
      <Route path="/construction">
        <ProtectedRoute><ConstructionWorks /></ProtectedRoute>
      </Route>
      <Route path="/construction/works/new">
        <ProtectedRoute><RequirePermission module="M-08" action="Create"><WorkForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/construction/works/:id/edit">
        <ProtectedRoute><RequirePermission module="M-08" action="Update"><WorkForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/construction/works/:id">
        <ProtectedRoute><WorkDetail /></ProtectedRoute>
      </Route>
      <Route path="/construction/amc">
        <ProtectedRoute><ConstructionAmc /></ProtectedRoute>
      </Route>
      <Route path="/correspondence/inward">
        <ProtectedRoute><DakInward /></ProtectedRoute>
      </Route>
      <Route path="/correspondence/inward/new">
        <ProtectedRoute><RequirePermission module="M-09" action="Create"><DakInwardForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/correspondence/inward/:id/edit">
        <ProtectedRoute><RequirePermission module="M-09" action="Update"><DakInwardForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/correspondence/inward/:id">
        <ProtectedRoute><DakInwardDetail /></ProtectedRoute>
      </Route>
      <Route path="/correspondence/outward">
        <ProtectedRoute><DakOutward /></ProtectedRoute>
      </Route>
      <Route path="/correspondence/outward/new">
        <ProtectedRoute><RequirePermission module="M-09" action="Create"><DakOutwardForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/receipts">
        <ProtectedRoute><ReceiptList /></ProtectedRoute>
      </Route>
      <Route path="/receipts/new">
        <ProtectedRoute><RequirePermission module="M-05" action="Create"><ReceiptForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/receipts/ledger">
        <ProtectedRoute><LedgerReports /></ProtectedRoute>
      </Route>
      <Route path="/receipts/ioms">
        <ProtectedRoute><IomsReceiptList /></ProtectedRoute>
      </Route>
      <Route path="/receipts/ioms/:id">
        <ProtectedRoute><IomsReceiptDetail /></ProtectedRoute>
      </Route>
      <Route path="/receipts/ioms/reconciliation">
        <ProtectedRoute>
          <RequirePermission module="M-05" action="Read">
            <IomsReceiptReconciliation />
          </RequirePermission>
        </ProtectedRoute>
      </Route>
      <Route path="/reports/ioms">
        <ProtectedRoute><IomsReports /></ProtectedRoute>
      </Route>
      <Route path="/access-denied">
        <ProtectedRoute><AccessDenied /></ProtectedRoute>
      </Route>
      <Route path="/verify/:receiptNo" component={VerifyReceipt} />
      <Route path="/health" component={Health} />
      <Route path="/admin/users">
        <AdminRoute><AdminUsers /></AdminRoute>
      </Route>
      <Route path="/admin/roles">
        <AdminRoute><AdminRoles /></AdminRoute>
      </Route>
      <Route path="/admin/locations">
        <AdminRoute><AdminLocations /></AdminRoute>
      </Route>
      <Route path="/admin/config">
        <AdminRoute><AdminConfig /></AdminRoute>
      </Route>
      <Route path="/admin/audit">
        <AdminRoute><AdminAudit /></AdminRoute>
      </Route>
      <Route path="/admin/permissions">
        <AdminRoute><AdminPermissionMatrix /></AdminRoute>
      </Route>
      <Route path="/admin/sla-config">
        <AdminRoute><AdminSlaConfig /></AdminRoute>
      </Route>
      <Route path="/hr/employees/new">
        <ProtectedRoute><RequirePermission module="M-01" action="Create"><HrEmployeeForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/hr/employees/:id/edit">
        <ProtectedRoute><RequirePermission module="M-01" action="Update"><HrEmployeeForm /></RequirePermission></ProtectedRoute>
      </Route>
      <Route path="/hr/employees">
        <ProtectedRoute><HrEmployees /></ProtectedRoute>
      </Route>
      <Route path="/hr/employees/:id">
        <ProtectedRoute><HrEmployeeDetail /></ProtectedRoute>
      </Route>
      <Route path="/hr/leaves">
        <ProtectedRoute><LeaveRequests /></ProtectedRoute>
      </Route>
      <Route path="/hr/claims">
        <ProtectedRoute><HrClaims /></ProtectedRoute>
      </Route>
      <Route path="/hr/attendance">
        <ProtectedRoute><HrAttendance /></ProtectedRoute>
      </Route>
      <Route path="/hr/timesheets">
        <ProtectedRoute><HrTimesheets /></ProtectedRoute>
      </Route>
      <Route path="/hr/recruitment">
        <ProtectedRoute><HrRecruitment /></ProtectedRoute>
      </Route>
      <Route path="/traders/licences/:id">
        <ProtectedRoute><TraderLicenceDetail /></ProtectedRoute>
      </Route>
      <Route path="/traders/licences">
        <ProtectedRoute><TraderLicences /></ProtectedRoute>
      </Route>
      <Route path="/traders/blocking-log">
        <ProtectedRoute><TraderBlockingLog /></ProtectedRoute>
      </Route>
      <Route path="/assets/allotments">
        <ProtectedRoute><AssetAllotments /></ProtectedRoute>
      </Route>
      <Route path="/assets/vacant">
        <ProtectedRoute><AssetsVacant /></ProtectedRoute>
      </Route>
      <Route path="/assets">
        <ProtectedRoute><AssetList /></ProtectedRoute>
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
          <Auth403Listener />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
