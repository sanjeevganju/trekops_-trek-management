/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, Component } from 'react';
import { 
  Mountain, 
  Users, 
  CheckCircle2, 
  Circle, 
  Calendar, 
  ChevronRight, 
  LayoutDashboard,
  ClipboardList,
  Clock,
  MapPin,
  Plus,
  Search,
  X,
  Trophy,
  Compass,
  Filter,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  User,
  LogOut,
  LogIn,
  Truck,
  FileText,
  Tent,
  Utensils,
  Wallet,
  Database,
  RefreshCw,
  ChevronLeft,
  Trash2,
  Upload,
  Check,
  ChevronDown,
  Shield,
  Lock,
  Cloud,
  ExternalLink,
  WifiOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  getDoc,
  getDocFromServer,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
  deleteDoc,
  writeBatch,
  getDocs,
  setDoc,
  limit
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  ref, 
  uploadBytesResumable, 
  getDownloadURL,
  deleteObject,
  listAll
} from 'firebase/storage';
import { GoogleGenAI, Type } from "@google/genai";
import { db, auth, storage } from './firebase';
import { TASK_TEMPLATES, TrekType, Category, TaskTemplate, REGIONS } from './constants';
import { formatDate, formatDeadline, isOverdue } from './utils';
import { fetchStaffList, StaffMember } from './services/staffService';
import { fetchSalesTrips, SalesTrip } from './services/salesService';
import { fetchDrivers, fetchVehicles, Driver, Vehicle } from './services/transportService';

// --- Error Handling ---
// --- Utilities ---
const parseTrekDate = (date: any): Date => {
  try {
    if (!date) return new Date(0);
    
    // Handle Firestore Timestamp
    if (typeof date === 'object' && date !== null && 'seconds' in date) {
      return new Date(date.seconds * 1000);
    }
    if (date && typeof date.toDate === 'function') {
      return date.toDate();
    }
    
    // Handle string or number
    let d = new Date(date);
    if (!isNaN(d.getTime())) return d;
    
    // Handle DD-MMM-YYYY manually (e.g., 13-Mar-2026)
    if (typeof date === 'string') {
      const clean = date.trim();
      const parts = clean.split(/[-/.]/);
      if (parts.length === 3) {
        let [day, month, year] = parts;
        // If year is first (YYYY-MM-DD), parts[0] is year
        if (day.length === 4) {
          [year, month, day] = [parts[0], parts[1], parts[2]];
        }
        
        const monthMap: Record<string, string> = {
          jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
          jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        };
        
        if (isNaN(Number(month))) {
          month = monthMap[month.toLowerCase().substring(0, 3)] || '01';
        }
        
        const fullYear = year.length === 2 ? `20${year}` : year;
        const isoStr = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        d = new Date(isoStr);
        if (!isNaN(d.getTime())) return d;
      }
    }
    return new Date(0);
  } catch (e) {
    console.error("Error parsing date:", date, e);
    return new Date(0);
  }
};

const normalizeRegion = (region: any): string => {
  try {
    if (!region || typeof region !== 'string') return 'Nepal';
    const r = region.toUpperCase().trim();
    
    if (r.includes('HIMACHAL')) return 'Himachal';
    if (r.includes('UTTARAKHAND')) return 'Uttarakhand';
    if (r.includes('LADAKH')) return 'Ladakh';
    if (r.includes('J&K') || r.includes('KASHMIR')) return 'Kashmir';
    if (r.includes('SIKKIM')) return 'Sikkim';
    if (r.includes('BHUTAN')) return 'Bhutan';
    if (r.includes('NEPAL')) return 'Nepal';
    
    return region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
  } catch (e) {
    return 'Nepal';
  }
};

const getTrekDateString = (date: any): string => {
  const d = parseTrekDate(date);
  if (isNaN(d.getTime()) || d.getTime() === 0) return 'no-date';
  // Use local date parts to avoid timezone shifts in toISOString
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getStableTrekId = (trek: { name: string; startDate: any }): string => {
  const trekNameSlug = trek.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const trekDateStr = getTrekDateString(trek.startDate);
  return `trek-${trekNameSlug}-${trekDateStr}`;
};

const getTaskStableId = (trekStableId: string, taskTitle: string): string => {
  const taskNameSlug = taskTitle.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `task-${trekStableId}-${taskNameSlug}`;
};

const isTaskRelatedToTrek = (task: any, trekId: string, stableTrekId: string): boolean => {
  if (!task) return false;
  const tid = task.trekId;
  const id = task.id;
  return tid === trekId || 
         tid === stableTrekId || 
         (id && id.startsWith(`task-${stableTrekId}-`)) ||
         (id && id.startsWith(`task-${trekId}-`));
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };
  props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.props = props;
  }

  static getDerivedStateFromError(error: any) {
    console.error("ErrorBoundary caught error:", error);
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error.includes('insufficient permissions')) {
          message = "You don't have permission to perform this action.";
        } else {
          message = parsed.error;
        }
      } catch (e) {
        message = this.state.error?.message || String(this.state.error);
      }
      const isAuthError = message.includes('auth/') || message.includes('Pending promise');

      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50">
          <div className="bg-rose-50 p-4 rounded-full mb-4">
            <AlertCircle className="w-12 h-12 text-rose-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Oops!</h2>
          <p className="text-slate-500 mb-6 max-w-xs">{message}</p>
          
          {isAuthError && (
            <p className="text-xs text-amber-600 mb-6 max-w-xs bg-amber-50 p-3 rounded-lg border border-amber-100">
              This looks like a login issue. Try "Reset App State" below to clear the error.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <button 
              onClick={() => window.location.reload()}
              className="bg-emerald-600 text-white font-bold px-8 py-3 rounded-2xl shadow-lg shadow-emerald-200"
            >
              Reload App
            </button>
            <button 
              onClick={() => this.setState({ hasError: false, error: null })}
              className="bg-white border border-slate-200 text-slate-600 font-bold px-8 py-3 rounded-2xl hover:bg-slate-50 transition-all"
            >
              Reset App State
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Types ---
interface Task {
  id: string;
  trekId: string;
  category: Category;
  title: string;
  description: string;
  deadlineOffset: number;
  status: 'pending' | 'completed';
  type: 'number' | 'text' | 'file' | 'select' | 'amount';
  value?: any;
  fileUrl?: string;
  files?: { url: string, name: string }[];
  isNA?: boolean;
  options?: string[];
  subtasks?: any[];
  contact?: string;
  isScanned?: boolean;
}

interface TrekInstance {
  id: string;
  name: string;
  type: TrekType;
  startDate: string;
  endDate?: string;
  pax?: number;
  region: string;
  location: string;
  status: 'planning' | 'active' | 'completed';
  createdAt?: any;
  salesTripId?: string;
}

// --- Main App ---
function TrekOpsApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [view, setView] = useState<'dashboard' | 'region-treks' | 'trek-details' | 'team'>('dashboard');
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [selectedTrek, setSelectedTrek] = useState<TrekInstance | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [treks, setTreks] = useState<TrekInstance[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoaded, setTasksLoaded] = useState(false);

  const getTrekProgress = (trekId: string) => {
    try {
      if (!tasks || !Array.isArray(tasks)) return { percent: 0, color: 'bg-slate-300' };
      const trek = treks.find(t => t.id === trekId);
      const stableTrekId = trek ? getStableTrekId(trek) : trekId;
      const trekTasks = tasks.filter(t => isTaskRelatedToTrek(t, trekId, stableTrekId));
      if (trekTasks.length === 0) return { percent: 0, color: 'bg-rose-500' };
      
      const completedTasks = trekTasks.filter(t => t.status === 'completed' || t.isNA).length;
      const percent = Math.round((completedTasks / trekTasks.length) * 100);
      
      if (percent === 100) return { percent, color: 'bg-emerald-500' };
      if (percent >= 75) return { percent, color: 'bg-blue-500' };
      if (percent >= 50) return { percent, color: 'bg-yellow-400' };
      if (percent >= 25) return { percent, color: 'bg-orange-500' };
      return { percent, color: 'bg-rose-500' };
    } catch (e) {
      console.error("Error calculating trek progress:", e);
      return { percent: 0, color: 'bg-slate-300' };
    }
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [selectedSalesTrips, setSelectedSalesTrips] = useState<string[]>([]);
  const [newTrek, setNewTrek] = useState({ name: '', type: 'Trek' as TrekType, startDate: '', endDate: '', pax: 2, region: 'Nepal', location: '' });
  const [typeFilter, setTypeFilter] = useState<TrekType | 'All'>('All');
  const [showCompleted, setShowCompleted] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [salesTrips, setSalesTrips] = useState<SalesTrip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [isRefreshingPax, setIsRefreshingPax] = useState(false);
  const [paxUpdateMessage, setPaxUpdateMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [showCompletedSales, setShowCompletedSales] = useState(false);

  const [isFirestoreOffline, setIsFirestoreOffline] = useState(false);
  const [isTreksLoading, setIsTreksLoading] = useState(true);
  const [treksError, setTreksError] = useState<string | null>(null);
  const [uploadingTaskId, setUploadingTaskId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  const [isAdminMode, setIsAdminMode] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminPasscode, setAdminPasscode] = useState('');
  const [adminPasscodeError, setAdminPasscodeError] = useState(false);

  const [isScanning, setIsScanning] = useState(false);
  const [scanResults, setScanResults] = useState<any[] | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanningTask, setScanningTask] = useState<Task | null>(null);
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);

  useEffect(() => {
    checkGoogleStatus();
    
    const handleMessage = (event: MessageEvent) => {
      console.log('Received message from popup:', event.data);
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        console.log('OAuth success message received, checking status...');
        checkGoogleStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  // @ts-ignore - accessing internal property for debugging
  const dbId = (db as any)._databaseId?.database || '(default)';

  const checkGoogleStatus = async () => {
    if (!user) return false;
    setIsRefreshingStatus(true);
    console.log('Manually checking Google status...');
    try {
      const res = await fetch(`/api/google/status?userId=${user.uid}`, { credentials: 'include' });
      const data = await res.json();
      console.log('Google status check result:', data);
      setIsGoogleConnected(data.connected);
      return data.connected;
    } catch (error) {
      console.error("Failed to check Google status:", error);
      return false;
    } finally {
      // Keep the spin for at least 500ms so it's visible
      setTimeout(() => setIsRefreshingStatus(false), 500);
    }
  };

  // Expose to window for the popup to call
  useEffect(() => {
    (window as any).checkGoogleStatus = checkGoogleStatus;
    return () => { delete (window as any).checkGoogleStatus; };
  }, [user]);

  const handleConnectGoogle = async () => {
    if (!user) return;
    try {
      const res = await fetch(`/api/auth/google/url?userId=${user.uid}`, { credentials: 'include' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to get auth URL');
      }
      const { url } = await res.json();
      
      const authWindow = window.open(url, 'google_oauth', 'width=600,height=700');
      
      if (!authWindow) {
        alert('Popup blocked! Please allow popups for this site to connect Google Drive.');
        return;
      }
    } catch (error) {
      console.error("Failed to get Google auth URL:", error);
      alert(`Connection Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Listen to Google connection status in Firestore
  useEffect(() => {
    if (!user) {
      setIsGoogleConnected(false);
      return;
    }

    const userDocRef = doc(db, "users", user.uid);
    // @ts-ignore - accessing internal property for debugging
    const dbId = db._databaseId?.database || '(default)';
    console.log("Setting up Firestore listener for user:", user.uid, "on project:", db.app.options.projectId, "database:", dbId);
    const unsubscribe = onSnapshot(userDocRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        console.log("User doc update received:", data);
        if (data.google_auth) {
          console.log("Google connection detected in Firestore");
          setIsGoogleConnected(true);
        } else {
          console.log("Google connection NOT found in doc");
          setIsGoogleConnected(false);
        }
      } else {
        console.log("User doc does not exist yet");
        setIsGoogleConnected(false);
      }
    }, (err) => {
      console.error("Firestore listener error:", err);
    });

    // Also do an initial check via API
    checkGoogleStatus();

    return () => unsubscribe();
  }, [user]);

  const [debugLogs, setDebugLogs] = useState<any[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  // Listen to debug logs
  useEffect(() => {
    if (!user || !showDebug) return;
    const q = query(collection(db, "debug_logs"), orderBy("timestamp", "desc"), limit(10));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setDebugLogs(logs);
    }, (error) => {
      console.error("Debug logs listener error:", error);
    });
    return () => unsubscribe();
  }, [user, showDebug]);

  const [backendStatus, setBackendStatus] = useState<any>(null);

  useEffect(() => {
    if (!user || !showDebug) return;
    const unsubscribe = onSnapshot(doc(db, "system_status", "backend"), (doc) => {
      if (doc.exists()) {
        setBackendStatus(doc.data());
      }
    }, (err) => {
      console.error("Error listening to backend status:", err);
      setBackendStatus(null);
    });
    return () => unsubscribe();
  }, [user, showDebug]);

  const handleSyncToSheets = async (task: Task) => {
    if (!isGoogleConnected || !selectedTrek || !user) return;
    
    try {
      setIsScanning(true);
      console.log("Syncing to sheets for task:", task.title);
      const q = query(
        collection(db, 'extracted_lists'), 
        where('taskId', '==', task.id),
        orderBy('scannedAt', 'desc'),
        limit(1)
      );
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        alert("No extracted data found for this task in the database. Please scan it first.");
        return;
      }

      const extractedData = querySnapshot.docs[0].data();
      
      const res = await fetch('/api/google/save-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          userId: user.uid,
          trekName: selectedTrek.name,
          taskTitle: task.title,
          data: extractedData.data
        })
      });

      if (res.ok) {
        alert("Successfully synced to Google Sheets!");
      } else {
        const error = await res.json();
        throw new Error(error.error || "Failed to sync to Google Sheets");
      }
    } catch (error: any) {
      console.error("Sync error:", error);
      alert(`Sync failed: ${error.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const ADMIN_PASSCODE = "1234"; // Static passcode as requested

  // --- Error Handling ---
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('Global Error Caught:', event.error);
      setTreksError(`Runtime Error: ${event.error?.message || 'Unknown error'}`);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason?.message || String(event.reason);
      console.error('Unhandled Rejection:', event.reason);
      
      // Ignore common environment-related WebSocket errors that are benign
      if (reason.includes('WebSocket') || reason.includes('HMR')) {
        return;
      }

      // Ignore internal Firebase assertions that are often transient or benign
      const upperReason = reason.toUpperCase();
      if (upperReason.includes('INTERNAL ASSERTION FAILED') || upperReason.includes('PENDING PROMISE WAS NEVER SET')) {
        console.warn('Ignoring internal Firebase assertion error:', reason);
        return;
      }
      
      setTreksError(`Promise Rejection: ${reason}`);
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
    });

    // Safety timeout: if auth state doesn't resolve in 10 seconds, force it to ready
    // so the user can at least see the login screen or an error.
    const timer = setTimeout(() => {
      setIsAuthReady((prev) => {
        if (!prev) {
          console.warn('Auth state check timed out after 10s. Forcing ready state.');
          return true;
        }
        return prev;
      });
    }, 10000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        console.log('Testing Firestore connection...');
        // Use getDoc instead of getDocFromServer to be more resilient to internal assertions
        // while still triggering a network request on first load.
        await getDoc(doc(db, 'test', 'connection'));
        setIsFirestoreOffline(false);
        console.log('Firestore connection test successful.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('the client is offline') || message.includes('Could not reach Cloud Firestore backend')) {
          console.error("Firestore is offline or unreachable.");
          setIsFirestoreOffline(true);
        } else if (message.includes('INTERNAL ASSERTION FAILED')) {
          console.warn("Caught internal assertion during connection test:", message);
          // Don't mark as offline, just log it
        } else {
          console.error("Firestore connection test error:", error);
        }
      }
    }
    if (isAuthReady && user) testConnection();
  }, [isAuthReady, user]);

  // Fetch Treks
  useEffect(() => {
    if (!isAuthReady || !user) return;

    console.log('Setting up onSnapshot(treks) listener...');
    const q = query(collection(db, 'treks'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`onSnapshot(treks): received ${snapshot.docs.length} documents`);
      const trekData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as TrekInstance[];
      
      // Sort in memory to avoid Firestore filtering out documents with missing fields
      trekData.sort((a, b) => {
        const dateA = a.startDate || '';
        const dateB = b.startDate || '';
        return dateA.localeCompare(dateB);
      });
      
      setTreks(trekData);
      setTreksError(null);
      setIsFirestoreOffline(false);
      setIsTreksLoading(false);
    }, (error) => {
      console.error('onSnapshot(treks) error:', error);
      setTreksError(error.message);
      setIsTreksLoading(false);
      if (error.message.includes('offline') || error.message.includes('insufficient permissions')) {
        setIsFirestoreOffline(true);
      }
    });

    // Safety timeout for treks loading
    const timer = setTimeout(() => {
      setIsTreksLoading((prev) => {
        if (prev) {
          console.warn('Treks loading timed out after 15s.');
          return false;
        }
        return prev;
      });
    }, 15000);

    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [isAuthReady, user]);

  // Fetch Tasks
  useEffect(() => {
    if (!isAuthReady || !user) return;

    // Fetch all tasks so progress indicators work in list views
    const q = query(collection(db, 'tasks'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log(`App: Received ${snapshot.docs.length} tasks from Firestore`);
      const taskData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(taskData);
      setTasksLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Fetch Staff
  useEffect(() => {
    if (!isAuthReady || !user) return;
    const loadStaff = async () => {
      const list = await fetchStaffList();
      setStaff(list);
    };
    loadStaff();
  }, [isAuthReady, user]);

  // Fetch Transport Data
  useEffect(() => {
    if (!isAuthReady || !user) return;
    const loadTransportData = async () => {
      console.log('App: Loading transport data...');
      const [driverList, vehicleList] = await Promise.all([
        fetchDrivers(),
        fetchVehicles()
      ]);
      console.log('App: Drivers loaded:', driverList.length);
      console.log('App: Vehicles loaded:', vehicleList.length);
      setDrivers(driverList);
      setVehicles(vehicleList);
    };
    loadTransportData();
  }, [isAuthReady, user]);

  const parseTrekDate = (date: any): Date => {
    try {
      if (!date) return new Date(0);
      
      // Handle Firestore Timestamp
      if (typeof date === 'object' && date !== null && 'seconds' in date) {
        return new Date(date.seconds * 1000);
      }
      if (date && typeof date.toDate === 'function') {
        return date.toDate();
      }
      
      // Handle string or number
      let d = new Date(date);
      if (!isNaN(d.getTime())) return d;
      
      // Handle DD-MMM-YYYY manually (e.g., 13-Mar-2026)
      if (typeof date === 'string') {
        const clean = date.trim();
        const parts = clean.split(/[-/.]/);
        if (parts.length === 3) {
          let [day, month, year] = parts;
          // If year is first (YYYY-MM-DD), parts[0] is year
          if (day.length === 4) {
            [year, month, day] = [parts[0], parts[1], parts[2]];
          }
          
          const monthMap: Record<string, string> = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
          };
          
          if (isNaN(Number(month))) {
            month = monthMap[month.toLowerCase().substring(0, 3)] || '01';
          }
          
          const fullYear = year.length === 2 ? `20${year}` : year;
          const isoStr = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
          d = new Date(isoStr);
          if (!isNaN(d.getTime())) return d;
        }
      }
      return new Date(0);
    } catch (e) {
      console.error("Error parsing date:", date, e);
      return new Date(0);
    }
  };

  const filteredTreks = useMemo(() => {
    try {
      let filtered = treks;
      if (selectedRegion) {
        filtered = filtered.filter(t => {
          const normalized = normalizeRegion(t.region);
          return normalized === selectedRegion;
        });
      }
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (showCompleted) {
        filtered = filtered.filter(t => {
          const date = t.endDate ? parseTrekDate(t.endDate) : parseTrekDate(t.startDate);
          return date < today;
        });
      } else {
        filtered = filtered.filter(t => {
          const date = t.endDate ? parseTrekDate(t.endDate) : parseTrekDate(t.startDate);
          return date >= today;
        });
      }

      if (typeFilter !== 'All') {
        filtered = filtered.filter(t => t.type === typeFilter);
      }
      return filtered;
    } catch (e) {
      console.error("Error filtering treks:", e);
      return [];
    }
  }, [treks, selectedRegion, typeFilter, showCompleted]);

  const isReadOnly = useMemo(() => {
    if (!selectedTrek) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parseTrekDate(selectedTrek.startDate) < today;
  }, [selectedTrek]);

  const toggleTask = async (task: Task) => {
    try {
      const taskRef = doc(db, 'tasks', task.id);
      const newStatus = task.status === 'completed' ? 'pending' : 'completed';
      await updateDoc(taskRef, {
        status: newStatus,
        completedAt: newStatus === 'completed' ? serverTimestamp() : null,
        completedBy: newStatus === 'completed' ? user?.uid : null
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${task.id}`);
    }
  };

  const updateTaskValue = async (taskId: string, field: string, value: any) => {
    try {
      const taskRef = doc(db, 'tasks', taskId);
      const updates: any = { [field]: value };
      
      // Auto-complete select tasks when a value is chosen
      const task = tasks.find(t => t.id === taskId);
      if (field === 'value' && value && task?.type === 'select') {
        updates.status = 'completed';
        updates.completedAt = serverTimestamp();
        updates.completedBy = auth.currentUser?.email;
      }

      await updateDoc(taskRef, updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `tasks/${taskId}`);
    }
  };

  const handleFileUpload = async (taskId: string, file: File) => {
    if (!file) return;
    
    setUploadingTaskId(taskId);
    setUploadProgress(0);
    
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      const storageRef = ref(storage, `tasks/${taskId}/${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on('state_changed', 
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(progress);
        }, 
        (error) => {
          console.error('Upload error:', error);
          setUploadingTaskId(null);
          setSalesError('Failed to upload file. Please try again.');
        }, 
        async () => {
          const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
          
          const isMultiUpload = task.category === 'Kitchen' || task.category === 'Equipment';
          
          if (isMultiUpload) {
            const currentFiles = task.files || [];
            const newFiles = [...currentFiles, { url: downloadURL, name: file.name }];
            await updateTaskValue(taskId, 'files', newFiles);
            // Also update fileUrl for backward compatibility/legacy UI
            if (!task.fileUrl) {
              await updateTaskValue(taskId, 'fileUrl', downloadURL);
            }
          } else {
            await updateTaskValue(taskId, 'fileUrl', downloadURL);
            await updateTaskValue(taskId, 'files', [{ url: downloadURL, name: file.name }]);
          }
          
          setUploadingTaskId(null);
          setUploadProgress(0);
        }
      );
    } catch (error) {
      console.error('File upload error:', error);
      setUploadingTaskId(null);
      setSalesError('Failed to upload file.');
    }
  };

  const handleDeleteFile = async (taskId: string, fileUrl: string) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      // Create a reference to the file to delete
      const fileRef = ref(storage, fileUrl);
      
      // Delete the file from storage
      await deleteObject(fileRef);
      
      // Update the task in Firestore
      const currentFiles = task.files || [];
      const newFiles = currentFiles.filter(f => f.url !== fileUrl);
      
      await updateTaskValue(taskId, 'files', newFiles);
      
      // If we deleted the main fileUrl, update it to the next available file or null
      if (task.fileUrl === fileUrl) {
        await updateTaskValue(taskId, 'fileUrl', newFiles.length > 0 ? newFiles[0].url : null);
      }
      
      console.log('File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      // Even if storage delete fails (e.g. file already gone), we still want to clear the reference in Firestore
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        const currentFiles = task.files || [];
        const newFiles = currentFiles.filter(f => f.url !== fileUrl);
        await updateTaskValue(taskId, 'files', newFiles);
        if (task.fileUrl === fileUrl) {
          await updateTaskValue(taskId, 'fileUrl', newFiles.length > 0 ? newFiles[0].url : null);
        }
      }
    }
  };

  const handleAdminAuth = () => {
    if (adminPasscode === ADMIN_PASSCODE) {
      setIsAdminMode(true);
      setIsAdminModalOpen(false);
      setAdminPasscode('');
      setAdminPasscodeError(false);
    } else {
      setAdminPasscodeError(true);
      setAdminPasscode('');
    }
  };

  const handleScanAndSave = async (task: Task) => {
    console.log("--- handleScanAndSave triggered ---");
    console.log("Task:", task.title);
    
    // Check both possible file locations
    const urls = [
      ...(task.files?.map(f => f.url) || []),
      ...(task.fileUrl ? [task.fileUrl] : [])
    ];
    
    console.log("Detected URLs:", urls);

    if (urls.length === 0) {
      alert("No files found to scan. Please upload an image first.");
      return;
    }
    
    setIsScanning(true);
    setScanningTask(task);
    setScanResults(null);
    setScanError(null);
    setIsScanModalOpen(true);

    try {
      // 1. Fetch all images and convert to base64
      console.log("Fetching images for frontend extraction (via proxy)...");
      const imageParts = await Promise.all(urls.map(async (url, index) => {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`Failed to fetch image ${index + 1}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64Data = (reader.result as string).split(',')[1];
            resolve({
              inlineData: {
                data: base64Data,
                mimeType: blob.type || "image/jpeg"
              }
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }));

      // 2. Initialize Gemini (Frontend uses process.env.GEMINI_API_KEY)
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
      
      console.log("Calling Gemini API from frontend...");
      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: "Extract the items, quantities, and any prices from these lists/images. Return the data as a single combined JSON array of objects with keys: 'item' (string), 'quantity' (string), and 'unit_price' (number, optional). If a price is not found, omit the key. Focus on making the list clean and readable. Combine duplicates if they are clearly the same item." },
              ...(imageParts as any[])
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                item: { type: Type.STRING },
                quantity: { type: Type.STRING },
                unit_price: { type: Type.NUMBER }
              },
              required: ["item", "quantity"]
            }
          }
        }
      });

      if (!result.text) throw new Error("Gemini returned an empty response.");

      const data = JSON.parse(result.text);
      console.log("Frontend extraction successful:", data);
      setScanResults(data);
    } catch (error: any) {
      console.error('Scanning error:', error);
      setScanError(error.message || 'An unexpected error occurred during scanning.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleConfirmScan = async () => {
    if (!scanningTask || !scanResults) return;

    try {
      setIsScanning(true); // Re-use scanning state for saving indicator
      // Save the extracted data to a new collection in Firestore
      // For now, we'll save it under 'extracted_lists' linked to the task
      await addDoc(collection(db, 'extracted_lists'), {
        taskId: scanningTask.id,
        trekId: selectedTrek?.id,
        trekName: selectedTrek?.name,
        taskTitle: scanningTask.title,
        data: scanResults,
        scannedAt: serverTimestamp(),
        scannedBy: user?.email
      });

      // Also update the task to indicate it has been scanned
      await updateTaskValue(scanningTask.id, 'isScanned', true);
      
      // Save to Google Sheets if connected
      if (isGoogleConnected) {
        try {
          await fetch('/api/google/save-list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trekName: selectedTrek?.name,
              taskTitle: scanningTask.title,
              data: scanResults
            })
          });
        } catch (err) {
          console.error("Failed to save to Google Sheets:", err);
          // We don't block the UI if Sheets fails, as Firestore succeeded
        }
      }
      
      if (isGoogleConnected) {
        alert("Successfully saved to Database and synced to Google Sheets!");
      } else {
        alert("Successfully saved to Database!");
      }

      setIsScanModalOpen(false);
      setScanResults(null);
      setScanningTask(null);
      setScanError(null);
      
      // Use a custom toast or just close the modal. 
      // The user will see the task updated in the list.
    } catch (error: any) {
      console.error('Error saving scan results:', error);
      setScanError(error.message || 'Failed to save extracted data to Firestore.');
    } finally {
      setIsScanning(false);
    }
  };

  const deleteTrek = async (trekId: string) => {
    // window.confirm is blocked in the iframe, so we'll proceed directly.
    // In a real app, we'd use a custom modal for this.
    try {
      // Delete trek
      await deleteDoc(doc(db, 'treks', trekId));
      
      // Delete associated tasks
      const trek = treks.find(t => t.id === trekId);
      const stableTrekId = trek ? getStableTrekId(trek) : trekId;
      const trekTasks = tasks.filter(t => isTaskRelatedToTrek(t, trekId, stableTrekId));
      const deletePromises = trekTasks.map(t => deleteDoc(doc(db, 'tasks', t.id)));
      await Promise.all(deletePromises);
      
      setSelectedTrek(null);
      setView('dashboard');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `treks/${trekId}`);
    }
  };

  useEffect(() => {
    if (treks.length > 0 && tasks.length > 0) {
      const missingHorseman = treks.filter(trek => {
        const stableTrekId = getStableTrekId(trek);
        const trekTasks = tasks.filter(t => isTaskRelatedToTrek(t, trek.id, stableTrekId));
        return !trekTasks.some(t => t.title === 'Horseman' && t.category === 'Team Assigned');
      });
      if (missingHorseman.length > 0) {
        console.log("TREKS MISSING HORSEMAN TASK:", missingHorseman.map(t => `${t.name} (${t.startDate})`).join(", "));
      } else {
        console.log("ALL TREKS HAVE HORSEMAN TASK");
      }
    }
  }, [treks, tasks]);

  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (selectedTrek && tasksLoaded && !isSyncing) {
      const stableTrekId = getStableTrekId(selectedTrek);
      const trekTasks = tasks.filter(t => isTaskRelatedToTrek(t, selectedTrek.id, stableTrekId));
      const categories: Category[] = ['Transport', 'Permits', 'Equipment', 'Kitchen', 'Team Assigned', 'Field Accounts'];
      
      const sync = async () => {
        setIsSyncing(true);
        try {
          for (const category of categories) {
            const templates = TASK_TEMPLATES[category] || [];
            for (const template of templates) {
              const taskStableId = getTaskStableId(stableTrekId, template.title);
              const existingTask = trekTasks.find(t => 
                t.id === taskStableId || 
                (t.title.toLowerCase().trim() === template.title.toLowerCase().trim() && t.category === category)
              );

              if (!existingTask) {
                console.log(`Creating missing task: ${template.title}`);
                await setDoc(doc(db, 'tasks', taskStableId), {
                  id: taskStableId,
                  trekId: stableTrekId,
                  category,
                  ...template,
                  status: 'pending',
                  createdAt: serverTimestamp()
                }, { merge: true });
              } else {
                // Task exists, ensure it's linked to the stable trek ID
                if (existingTask.trekId !== stableTrekId) {
                  console.log(`Claiming task ${existingTask.id} for trek ${stableTrekId}`);
                  await updateDoc(doc(db, 'tasks', existingTask.id), { trekId: stableTrekId });
                }
              }
            }
          }
        } catch (err) {
          console.error("Sync error:", err);
        } finally {
          setIsSyncing(false);
        }
      };

      sync();
    }
  }, [selectedTrek?.id, tasksLoaded]);

  const handleCreateTrek = async (e?: React.FormEvent, tripData?: SalesTrip) => {
    if (e) e.preventDefault();
    const data = tripData || newTrek;
    
    // Normalize region
    const normalizedRegion = normalizeRegion(data.region);
    
    // Generate Stable ID: trek-[name-slug]-[date]
    // This ensures that the same trek on the same date always has the same ID, preventing duplicates.
    const stableId = getStableTrekId(data);
    
    try {
      console.log(`Creating/Updating trek with stable ID: ${stableId}`);
      
      // Use setDoc instead of addDoc for stable IDs
      await setDoc(doc(db, 'treks', stableId), {
        ...data,
        region: normalizedRegion,
        id: stableId, // Ensure ID is stored in the document too
        status: 'active',
        createdAt: serverTimestamp(),
        createdBy: user?.uid,
        salesTripId: tripData?.id
      });

      const categories: Category[] = ['Transport', 'Permits', 'Equipment', 'Kitchen', 'Team Assigned', 'Field Accounts'];
      const taskPromises: Promise<any>[] = [];

      categories.forEach(category => {
        const templates = TASK_TEMPLATES[category] || [];
        templates.forEach(template => {
          // Generate Stable ID for tasks too: task-[trek-id]-[task-title-slug]
          const taskStableId = getTaskStableId(stableId, template.title);
          
          taskPromises.push(setDoc(doc(db, 'tasks', taskStableId), {
            id: taskStableId,
            trekId: stableId,
            category,
            ...template,
            status: 'pending',
            createdAt: serverTimestamp()
          }));
        });
      });

      await Promise.all(taskPromises);
      console.log(`Successfully initialized trek ${stableId} with ${taskPromises.length} tasks.`);
      
      setShowCompleted(false);

      if (!tripData) {
        setIsModalOpen(false);
        setNewTrek({ name: '', type: 'Trek', startDate: '', endDate: '', pax: 2, region: 'Nepal', location: '' });
      }
      if (normalizedRegion) setSelectedRegion(normalizedRegion);
      setView('region-treks');
    } catch (error) {
      console.error('Error creating trek:', error);
      handleFirestoreError(error, OperationType.CREATE, `treks/${stableId}`);
    }
  };

  useEffect(() => {
    if (isSalesModalOpen) {
      loadSalesData();
    }
  }, [isSalesModalOpen]);

  const handleImportSales = async () => {
    if (isImporting) return;
    if (isFirestoreOffline) {
      setSalesError('Firestore is offline. Please check your connection or re-set up Firebase.');
      setIsImporting(false);
      return;
    }

    setIsImporting(true);
    setSalesError(null);
    console.log(`Starting import of ${selectedSalesTrips.length} trips...`);
    
    // Safety timeout for the import process
    const importTimeout = setTimeout(() => {
      if (isImporting) {
        setIsImporting(false);
        setSalesError('Import timed out. Some treks might not have been created.');
      }
    }, 30000); // 30s timeout for bulk import

    try {
      let successCount = 0;
      for (const tripId of selectedSalesTrips) {
        const trip = salesTrips.find(t => t.id === tripId);
        if (trip) {
          console.log(`Importing trip: ${trip.name} (${trip.startDate})`);
          // Add a small delay between imports to avoid overwhelming Firestore if offline
          await handleCreateTrek(undefined, trip);
          successCount++;
        }
      }
      console.log(`Successfully imported ${successCount} trips.`);
      setIsSalesModalOpen(false);
      setSelectedSalesTrips([]);
    } catch (error: any) {
      console.error('Error importing sales:', error);
      let msg = 'Failed to import trips. Please try again.';
      if (error.message.includes('offline')) {
        msg = 'Firestore is offline. Import failed.';
      } else {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed.error.includes('insufficient permissions')) {
            msg = 'Permission denied. You may not have rights to create treks.';
          }
        } catch (e) {}
      }
      setSalesError(msg);
    } finally {
      clearTimeout(importTimeout);
      setIsImporting(false);
    }
  };

  const refreshPaxData = async () => {
    if (isRefreshingPax) return;
    
    setPaxUpdateMessage(null);
    setIsRefreshingPax(true);
    console.log('refreshPaxData: Starting sync...');

    try {
      const salesData = await fetchSalesTrips();
      console.log(`refreshPaxData: Fetched ${salesData.length} trips from sales.`);
      
      let updateCount = 0;
      const batch = writeBatch(db);

      for (const trek of treks) {
        // Try to match by salesTripId first, then by stable ID
        const matchingTrip = salesData.find(s => 
          (trek.salesTripId && s.id === trek.salesTripId) || 
          (s.id === trek.id)
        );

        if (matchingTrip) {
          const salesPax = Number(matchingTrip.pax);
          const currentPax = Number(trek.pax);
          
          if (salesPax !== currentPax) {
            console.log(`refreshPaxData: Updating ${trek.name} pax from ${currentPax} to ${salesPax}`);
            const trekRef = doc(db, 'treks', trek.id);
            batch.update(trekRef, { 
              pax: salesPax,
              salesTripId: matchingTrip.id // Ensure we save the ID for future syncs
            });
            updateCount++;
          }
        }
      }

      if (updateCount > 0) {
        await batch.commit();
        setPaxUpdateMessage({ text: `Successfully updated pax for ${updateCount} treks!`, type: 'success' });
      } else {
        setPaxUpdateMessage({ text: "All pax counts are already up to date.", type: 'success' });
      }
    } catch (error: any) {
      console.error("Error refreshing pax data:", error);
      setPaxUpdateMessage({ text: `Failed to refresh: ${error.message}`, type: 'error' });
    } finally {
      setIsRefreshingPax(false);
      // Clear message after 5 seconds
      setTimeout(() => setPaxUpdateMessage(null), 5000);
    }
  };

  const loadSalesData = async () => {
    if (isLoadingSales) return;
    console.log('loadSalesData called');
    setIsLoadingSales(true);
    setSalesError(null);
    
    let isFinished = false;
    
    // Safety timeout for the loading state
    const safetyTimeout = setTimeout(() => {
      if (!isFinished) {
        console.warn('loadSalesData: Safety timeout reached (60s).');
        setIsLoadingSales(false);
        setSalesError('The request to Google Sheets is taking too long (60s). This could be due to a slow network or the spreadsheet being very large.');
      }
    }, 60000); // 60s safety timeout

    try {
      console.log('loadSalesData: calling fetchSalesTrips...');
      const data = await fetchSalesTrips();
      isFinished = true;
      console.log(`loadSalesData: received ${data.length} trips successfully`);
      
      // Normalize regions from sales data
      const normalizedData = data.map(trip => ({
        ...trip,
        region: normalizeRegion(trip.region)
      }));
      
      setSalesTrips(normalizedData);
    } catch (error: any) {
      isFinished = true;
      console.error('Error loading sales data:', error);
      setSalesError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(safetyTimeout);
      setIsLoadingSales(false);
      console.log('loadSalesData finished');
    }
  };



  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const handleLogin = async () => {
    if (isLoggingIn || !isAuthReady) return;
    setIsLoggingIn(true);
    setTreksError(null); // Clear any previous errors
    try {
      const provider = new GoogleAuthProvider();
      // Force account selection to help with multi-account issues
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login Error:', error);
      if (error.code === 'auth/popup-blocked') {
        alert("The login popup was blocked by your browser. Please allow popups.");
      } else if (error.code === 'auth/cancelled-by-user' || error.code === 'auth/popup-closed-by-user') {
        // Ignore user-initiated cancellations
        console.log('Login cancelled by user');
      } else {
        setTreksError(`Login failed: ${error.message}.`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => signOut(auth);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const activeTreks = treks.filter(t => {
      const date = t.endDate ? parseTrekDate(t.endDate) : parseTrekDate(t.startDate);
      return date >= today;
    });
    
    return {
      totalTreks: treks.length,
      activeTrips: activeTreks.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      overdue: tasks.filter(t => t.status === 'pending' && selectedTrek && isOverdue(selectedTrek.startDate, t.deadlineOffset)).length
    };
  }, [treks, tasks, selectedTrek]);

  const regionStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return REGIONS.map(region => {
      const regionTreks = treks.filter(t => normalizeRegion(t.region) === region);
      const active = regionTreks.filter(t => {
        const date = t.endDate ? parseTrekDate(t.endDate) : parseTrekDate(t.startDate);
        return date >= today;
      }).length;
      
      return {
        name: region,
        active,
        total: regionTreks.length,
        progress: regionTreks.length > 0 ? (active / regionTreks.length) * 100 : 0
      };
    });
  }, [treks]);

  const categoryProgress = useMemo(() => {
    if (!selectedTrek) return {};
    const cats: Category[] = ['Transport', 'Permits', 'Equipment', 'Kitchen', 'Team Assigned', 'Field Accounts'];
    const progress: Record<string, { completed: number; total: number }> = {};
    
    const stableTrekId = getStableTrekId(selectedTrek);
    const trekTasks = tasks.filter(t => isTaskRelatedToTrek(t, selectedTrek.id, stableTrekId));
    
    cats.forEach(cat => {
      const catTasks = trekTasks.filter(t => t.category === cat);
      progress[cat] = {
        completed: catTasks.filter(t => t.status === 'completed' || t.isNA).length,
        total: catTasks.length
      };
    });
    return progress;
  }, [tasks, selectedTrek]);

  const overallProgress = useMemo(() => {
    if (!selectedTrek || tasks.length === 0) return 0;
    const stableTrekId = getStableTrekId(selectedTrek);
    const trekTasks = tasks.filter(t => isTaskRelatedToTrek(t, selectedTrek.id, stableTrekId));
    if (trekTasks.length === 0) return 0;
    const completed = trekTasks.filter(t => t.status === 'completed' || t.isNA).length;
    return Math.round((completed / trekTasks.length) * 100);
  }, [tasks, selectedTrek]);

  if (treksError) {
    const isNetworkError = treksError.includes('network-request-failed') || treksError.includes('offline');
    
    if (isNetworkError && user) {
      // For network errors when already logged in, show a non-blocking banner instead of full screen
      return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
          <div className="bg-amber-500 text-white px-4 py-2 text-center text-xs font-bold flex items-center justify-center gap-2">
            <WifiOff className="w-3 h-3" />
            Network connection issue. Some data may not be up to date.
            <button onClick={() => setTreksError(null)} className="underline ml-2">Dismiss</button>
          </div>
          {/* Render the rest of the app if possible, or a simplified version */}
          <div className="flex-1 flex items-center justify-center p-6 text-center">
             <div className="max-w-md">
               <h1 className="text-xl font-bold mb-2">Connection Issue</h1>
               <p className="text-sm text-slate-500 mb-6">We're having trouble reaching the database. This is usually temporary.</p>
               <button onClick={() => window.location.reload()} className="bg-emerald-600 text-white px-6 py-2 rounded-lg font-bold">Retry Connection</button>
             </div>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-6">
          <AlertCircle className="w-12 h-12 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Something went wrong</h1>
        <div className="bg-white border border-red-200 p-4 rounded-xl max-w-md mb-8">
          <p className="text-red-600 font-mono text-sm break-words">{treksError}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-4">
          <button 
            onClick={() => window.location.reload()}
            className="bg-emerald-600 text-white font-bold px-8 py-3 rounded-xl shadow-lg hover:bg-emerald-700 transition-all"
          >
            Try Refreshing
          </button>
          <button 
            onClick={() => {
              localStorage.clear();
              window.location.reload();
            }}
            className="bg-white border border-slate-200 text-slate-600 font-bold px-8 py-3 rounded-xl hover:bg-slate-50 transition-all"
          >
            Reset App State
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        >
          <Mountain className="w-12 h-12 text-emerald-600 opacity-20" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-emerald-600 p-4 rounded-3xl shadow-xl shadow-emerald-200 mb-8">
          <Mountain className="w-16 h-16 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2 tracking-tight">TrekOps</h1>
        <p className="text-slate-500 mb-10 max-w-xs">Manage your trekking operations with precision and ease.</p>
        <button 
          onClick={handleLogin}
          disabled={isLoggingIn}
          className="flex items-center gap-3 bg-white border border-slate-200 text-slate-700 font-bold px-8 py-4 rounded-2xl shadow-sm hover:shadow-md transition-all active:scale-[0.98] mb-6 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoggingIn ? (
            <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin" />
          ) : (
            <LogIn className="w-5 h-5 text-emerald-600" />
          )}
          {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
        </button>

        <div className="max-w-xs text-center">
          <p className="text-xs text-slate-400 mb-4 italic">
            Trouble signing in? Incognito mode or browser settings may block the login window.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-24">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-6 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2">
            <div className="bg-emerald-600 p-2 rounded-lg">
              <Mountain className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">TrekOps</h1>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => window.open(window.location.origin, '_blank')}
              className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
              title="Open App in New Tab (More Stable for Drive)"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            {isAdminMode && (
              <div className="flex items-center gap-2">
                <button 
                  onClick={checkGoogleStatus}
                  className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                  title="Refresh Connection Status"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                </button>
                <button 
                  onClick={handleConnectGoogle}
                  disabled={isRefreshingStatus}
                  className={`px-3 py-2 rounded-xl transition-all flex items-center gap-2 border shadow-sm ${
                    isGoogleConnected 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100' 
                      : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/30'
                  }`}
                  title={isGoogleConnected ? "Google Drive Connected" : "Connect Google Drive"}
                >
                  <div className="w-5 h-5 flex items-center justify-center bg-white rounded-lg shadow-sm border border-slate-100">
                    {isRefreshingStatus ? (
                      <RefreshCw className="w-3.5 h-3.5 text-emerald-500 animate-spin" />
                    ) : (
                      <Cloud className={`w-3.5 h-3.5 ${isGoogleConnected ? 'text-emerald-500' : 'text-blue-500'}`} />
                    )}
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">
                    {isRefreshingStatus ? "Checking..." : isGoogleConnected ? "Connected" : "Connect Drive"}
                  </span>
                </button>
                {!isGoogleConnected && (
                  <button 
                    onClick={() => checkGoogleStatus()}
                    disabled={isRefreshingStatus}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    title="Refresh connection status"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRefreshingStatus ? 'animate-spin' : ''}`} />
                  </button>
                )}
                {isGoogleConnected && (
                  <button 
                    onClick={async () => {
                      if(confirm("Disconnect Google Drive?")) {
                        await fetch('/api/google/logout', { method: 'POST' });
                        checkGoogleStatus();
                      }
                    }}
                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                    title="Disconnect Google Drive"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            <button 
              onClick={() => isAdminMode ? setIsAdminMode(false) : setIsAdminModalOpen(true)}
              className={`p-2 rounded-lg transition-colors ${isAdminMode ? 'bg-emerald-100 text-emerald-600' : 'hover:bg-slate-100 text-slate-400'}`}
              title={isAdminMode ? "Exit Admin Mode" : "Admin Mode"}
            >
              <Shield className="w-5 h-5" />
            </button>
            <div className="relative">
              <button 
                onClick={refreshPaxData}
                disabled={isRefreshingPax}
                className={`p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors ${isRefreshingPax ? 'animate-pulse' : ''}`}
                title="Refresh Pax from Sales"
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshingPax ? 'animate-spin' : ''}`} />
              </button>
              
              <AnimatePresence>
                {paxUpdateMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`absolute top-full right-0 mt-2 w-48 p-2 rounded-xl shadow-xl border text-[10px] font-bold z-50 ${
                      paxUpdateMessage.type === 'success' 
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-600' 
                        : 'bg-rose-50 border-rose-100 text-rose-600'
                    }`}
                  >
                    {paxUpdateMessage.text}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button 
              onClick={() => setShowDebug(!showDebug)}
              className={`p-2 rounded-lg transition-colors ${showDebug ? 'bg-amber-100 text-amber-600' : 'hover:bg-slate-100 text-slate-400'}`}
              title="Debug Logs"
            >
              <AlertTriangle className="w-5 h-5" />
            </button>
            <button 
              onClick={handleLogout}
              className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="Profile" referrerPolicy="no-referrer" />
              ) : (
                <User className="w-5 h-5 text-slate-400" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {view === 'dashboard' && (
            <motion.div 
              key="dashboard"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              <div className="bg-emerald-700 text-white p-6 rounded-b-[2rem] -mx-4 -mt-6 mb-8 text-center shadow-lg">
                <div className="flex justify-center mb-2">
                  <Mountain className="w-8 h-8" />
                </div>
                <h2 className="text-2xl font-bold">Trek Task Manager</h2>
                <p className="text-emerald-100 text-sm opacity-80">Select Your Base</p>
                {isAdminMode && (
                  <div className="mt-2 inline-flex items-center gap-1.5 bg-white/20 px-3 py-1 rounded-full border border-white/30">
                    <Shield className="w-3 h-3" />
                    <span className="text-[10px] font-black uppercase tracking-widest">Admin Mode Active</span>
                  </div>
                )}
              </div>

              {/* Treks Loading/Error Display */}
              {isTreksLoading && !treksError && (
                <div className="flex items-center gap-2 mb-4 p-3 bg-slate-50 rounded-xl animate-pulse">
                  <RefreshCw className="w-4 h-4 text-slate-400 animate-spin" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Connecting to database...</span>
                </div>
              )}

              {isFirestoreOffline && !treksError && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl mb-6 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-bold text-rose-600 uppercase tracking-wider">Database Connection Failed</p>
                    <p className="text-[10px] text-rose-500 mt-1">
                      Could not connect to Firestore. Please <b>re-set up Firebase</b> from the AI Studio menu or check your internet connection.
                    </p>
                  </div>
                </div>
              )}

              {treksError && (
                <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
                  <div className="flex items-center">
                    <AlertTriangle className="h-5 w-5 text-red-400 mr-2" />
                    <div className="flex-1">
                      <p className="text-sm text-red-700">
                        Error loading treks: {treksError}.
                      </p>
                      {treksError.includes('offline') && (
                        <p className="text-xs text-red-600 mt-1 font-bold">
                          The app is having trouble connecting to the database. This often happens in remixed apps. Please try re-setting up Firebase from the settings.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <section className="grid grid-cols-2 gap-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm text-center">
                  <div className="text-3xl font-bold text-emerald-600">{stats.activeTrips}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">Active Trips</div>
                </div>
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm text-center relative group">
                  <div className="text-3xl font-bold text-slate-800">{stats.totalTreks}</div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">Total Trips</div>
                  <button 
                    onClick={() => window.location.reload()}
                    className="absolute top-2 right-2 p-1 text-slate-300 hover:text-emerald-600 transition-colors opacity-0 group-hover:opacity-100"
                    title="Force Refresh"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <div className="mt-2 flex flex-col gap-1">
                    {treks.length === 0 && !treksError && (
                      <button onClick={() => setIsSalesModalOpen(true)} className="text-[10px] text-emerald-600 font-bold underline">
                        Import from Sales
                      </button>
                    )}
                  </div>
                </div>
              </section>

              {isAdminMode && (
                <div className="p-6 bg-slate-900 rounded-[2rem] text-white space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Database Inspector</h3>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <div className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-[8px] font-black uppercase">Admin</div>
                      <div className="text-[6px] text-slate-500 font-mono truncate max-w-[150px]">{db.type === 'firestore' ? (db as any)._databaseId.database : 'default'}</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <div className="text-2xl font-bold">{treks.length}</div>
                      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1">Raw Treks</div>
                    </div>
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                      <div className="text-2xl font-bold">{tasks.length}</div>
                      <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest mt-1">Raw Tasks</div>
                    </div>
                  </div>


                </div>
              )}

              <div className="flex items-center justify-center gap-2 py-2">
                <input 
                  type="checkbox" 
                  id="showCompleted" 
                  checked={showCompleted}
                  onChange={(e) => setShowCompleted(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600"
                />
                <label htmlFor="showCompleted" className="text-sm font-medium text-slate-600">Show Completed Treks</label>
              </div>

              <section className="grid grid-cols-2 gap-4">
                {regionStats.map(region => (
                  <motion.div 
                    key={region.name}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => {
                      setSelectedRegion(region.name);
                      setView('region-treks');
                    }}
                    className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm space-y-4 relative overflow-hidden group cursor-pointer"
                  >
                    <div className="flex flex-col items-center text-center">
                      <div className={`p-3 rounded-2xl mb-3 ${
                        region.name === 'Nepal' ? 'bg-blue-50 text-blue-600' :
                        region.name === 'Sikkim' ? 'bg-rose-50 text-rose-600' :
                        region.name === 'Uttarakhand' ? 'bg-emerald-50 text-emerald-600' :
                        region.name === 'Bhutan' ? 'bg-green-50 text-green-600' :
                        region.name === 'Ladakh' ? 'bg-amber-50 text-amber-600' :
                        region.name === 'Himachal' ? 'bg-teal-50 text-teal-600' :
                        'bg-indigo-50 text-indigo-600'
                      }`}>
                        {region.name === 'Nepal' ? <Mountain className="w-6 h-6" /> :
                         region.name === 'Sikkim' ? <Users className="w-6 h-6" /> :
                         region.name === 'Uttarakhand' ? <Compass className="w-6 h-6" /> :
                         region.name === 'Bhutan' ? <Tent className="w-6 h-6" /> :
                         region.name === 'Ladakh' ? <TrendingUp className="w-6 h-6" /> :
                         region.name === 'Himachal' ? <MapPin className="w-6 h-6" /> :
                         <LayoutDashboard className="w-6 h-6" />}
                      </div>
                      <h3 className="font-bold text-slate-800">{region.name}</h3>
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>Active:</span>
                        <span className="text-slate-600">{region.active}</span>
                      </div>
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>Total:</span>
                        <span className="text-slate-600">{region.total}</span>
                      </div>
                    </div>

                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${region.progress}%` }}
                        className={`h-full ${
                          region.name === 'Nepal' ? 'bg-blue-500' :
                          region.name === 'Sikkim' ? 'bg-rose-500' :
                          region.name === 'Uttarakhand' ? 'bg-emerald-500' :
                          region.name === 'Bhutan' ? 'bg-green-500' :
                          region.name === 'Ladakh' ? 'bg-amber-500' :
                          region.name === 'Himachal' ? 'bg-teal-500' :
                          'bg-indigo-500'
                        }`}
                      />
                    </div>
                    <div className="text-[9px] font-bold text-center text-slate-400 uppercase">{Math.round(region.progress)}% active</div>
                  </motion.div>
                ))}

                <motion.div 
                  whileTap={{ scale: 0.98 }}
                  className="bg-emerald-50 p-5 rounded-3xl border border-emerald-100 shadow-sm flex flex-col items-center justify-center text-center space-y-3 cursor-pointer"
                  onClick={() => setIsSalesModalOpen(true)}
                >
                  <div className="p-3 bg-white rounded-full text-emerald-600 shadow-sm">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-emerald-800">Add Trips</h3>
                    <p className="text-[10px] font-bold text-emerald-600 uppercase">From Sales</p>
                  </div>
                </motion.div>
              </section>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => setIsModalOpen(true)}
                  className="flex-1 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider py-3 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-100"
                >
                  <Plus className="w-3 h-3" /> Create Trek
                </button>
              </div>
            </motion.div>
          )}

          {view === 'region-treks' && (
            <motion.div 
              key="region-treks"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="bg-emerald-700 text-white p-6 rounded-b-[2rem] -mx-4 -mt-6 mb-8 flex items-center gap-4">
                <button onClick={() => { setView('dashboard'); setSelectedRegion(null); }} className="p-2 hover:bg-emerald-600 rounded-full transition-colors">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <div className="flex-1 text-center pr-10">
                  <h2 className="text-xl font-bold">{selectedRegion} Treks</h2>
                  <p className="text-emerald-100 text-[10px] uppercase font-bold tracking-widest opacity-80">Select a trip to manage</p>
                </div>
              </div>

              <div className="flex items-center justify-between mb-4 px-1">
                <div className="flex gap-2">
                  <select 
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value as TrekType | 'All')}
                    className="text-xs font-bold bg-white border border-slate-200 rounded-xl px-4 py-2 outline-none text-slate-600 shadow-sm"
                  >
                    <option value="All">All Types</option>
                    <option value="Trek">Treks</option>
                    <option value="Expedition">Expeditions</option>
                    <option value="Climb">Climbs</option>
                  </select>
                  <button 
                    onClick={() => setShowCompleted(!showCompleted)}
                    className={`text-xs font-bold px-4 py-2 rounded-xl border transition-all ${
                      showCompleted ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600'
                    }`}
                  >
                    {showCompleted ? 'Completed Treks' : 'Active Treks'}
                  </button>
                </div>
                <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full uppercase tracking-wider">{filteredTreks.length} Treks</span>
              </div>

              <div className="grid gap-4">
                {filteredTreks.map(trek => (
                  <motion.div
                    key={trek.id}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setSelectedTrek(trek); setView('trek-details'); }}
                    className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm flex items-center justify-between group cursor-pointer relative"
                  >
                    {/* Progress Indicator Dot - Top Right */}
                    <div 
                      className={`absolute top-4 right-4 w-2 h-2 rounded-full ${getTrekProgress(trek.id).color} shadow-sm flex-shrink-0`} 
                      title={`${getTrekProgress(trek.id).percent}% complete`} 
                    />

                    <div className="flex items-center gap-4 pr-6">
                      <div className={`p-3 rounded-2xl flex-shrink-0 ${
                        trek.type === 'Expedition' ? 'bg-amber-50 text-amber-600' : 
                        trek.type === 'Climb' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                      }`}>
                        <Mountain className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-800 text-lg leading-tight">{trek.name || 'Unnamed Trek'}</h3>
                        <div className="flex items-center gap-3 mt-1.5">
                          <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase">
                            <Calendar className="w-3 h-3" />
                            <span>{formatDate(trek.startDate)}</span>
                          </div>
                          <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase">
                            <Users className="w-3 h-3" />
                            <span>{trek.pax || 0} Pax</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-slate-300 group-hover:text-emerald-500 transition-colors" />
                  </motion.div>
                ))}
                {filteredTreks.length === 0 && (
                  <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-slate-200">
                    <p className="text-slate-400 text-sm font-medium">No treks found in this region.</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {view === 'trek-details' && selectedTrek && (
            <motion.div 
              key="trek-details"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              {/* Trek Header */}
              <div className="bg-emerald-700 text-white p-6 rounded-b-[2rem] -mx-4 -mt-6 mb-8">
                <div className="flex items-center justify-between mb-6">
                  <button onClick={() => { setView('region-treks'); setSelectedTrek(null); setSelectedCategory(null); setSelectedTask(null); }} className="p-2 hover:bg-emerald-600 rounded-full transition-colors">
                    <ChevronLeft className="w-6 h-6" />
                  </button>
                      <div className="text-center">
                        <h2 className="text-lg font-bold uppercase tracking-wider">{selectedTrek.name}</h2>
                        <div className="flex items-center justify-center gap-2">
                          <p className="text-emerald-100 text-[10px] font-bold opacity-80">{formatDate(selectedTrek.startDate)} - {selectedTrek.endDate ? formatDate(selectedTrek.endDate) : '...'}</p>
                          {isReadOnly && (
                            <span className="text-[8px] font-black bg-white/20 text-white px-1.5 py-0.5 rounded uppercase tracking-widest border border-white/10">Read Only</span>
                          )}
                        </div>
                      </div>
                  {!isReadOnly && (
                    <button onClick={() => deleteTrek(selectedTrek.id)} className="p-2 hover:bg-rose-600 rounded-full transition-colors text-emerald-100">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {!selectedCategory ? (
                  <div className="space-y-6">
                    <div className="flex flex-col items-center justify-center py-4">
                      <div className="relative w-32 h-32 flex items-center justify-center">
                        <svg className="w-full h-full -rotate-90">
                          <circle cx="64" cy="64" r="58" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                          <motion.circle 
                            cx="64" cy="64" r="58" fill="none" stroke="white" strokeWidth="8" 
                            strokeDasharray={364.4}
                            initial={{ strokeDashoffset: 364.4 }}
                            animate={{ strokeDashoffset: 364.4 - (364.4 * overallProgress / 100) }}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="text-3xl font-black">{overallProgress}%</span>
                          <span className="text-[8px] font-bold uppercase opacity-60">Complete</span>
                        </div>
                      </div>
                      <p className="text-xs font-bold mt-4 text-emerald-100 opacity-80">Overall Progress</p>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { id: 'Transport' as Category, icon: Truck, color: 'emerald' },
                        { id: 'Permits' as Category, icon: FileText, color: 'emerald' },
                        { id: 'Equipment' as Category, icon: Tent, color: 'emerald' },
                        { id: 'Kitchen' as Category, icon: Utensils, color: 'emerald' },
                        { id: 'Team Assigned' as Category, icon: Users, color: 'emerald' },
                        { id: 'Field Accounts' as Category, icon: Wallet, color: 'emerald' },
                      ].map(cat => {
                        const prog = categoryProgress[cat.id] || { completed: 0, total: 0 };
                        const percent = prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0;
                        return (
                          <motion.button
                            key={cat.id}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => setSelectedCategory(cat.id)}
                            className="flex flex-col items-center gap-2"
                          >
                            <div className="relative w-16 h-16 flex items-center justify-center">
                              <svg className="w-full h-full -rotate-90">
                                <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                                <motion.circle 
                                  cx="32" cy="32" r="28" fill="none" stroke="white" strokeWidth="3" 
                                  strokeDasharray={175.9}
                                  initial={{ strokeDashoffset: 175.9 }}
                                  animate={{ strokeDashoffset: 175.9 - (175.9 * percent / 100) }}
                                  strokeLinecap="round"
                                />
                              </svg>
                              <div className="absolute inset-0 flex items-center justify-center">
                                <cat.icon className="w-6 h-6" />
                              </div>
                              <div className="absolute -bottom-1 -right-1 bg-white text-emerald-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                                {prog.completed}/{prog.total}
                              </div>
                            </div>
                            <span className="text-[9px] font-bold uppercase tracking-wider text-center">{cat.id}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <button onClick={() => { setSelectedCategory(null); setSelectedTask(null); }} className="p-2 hover:bg-emerald-600 rounded-full transition-colors">
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <div className="text-center flex-1">
                      <div className="flex items-center justify-center gap-2 mb-1">
                        {selectedCategory === 'Transport' && <Truck className="w-5 h-5" />}
                        {selectedCategory === 'Permits' && <FileText className="w-5 h-5" />}
                        {selectedCategory === 'Equipment' && <Tent className="w-5 h-5" />}
                        {selectedCategory === 'Kitchen' && <Utensils className="w-5 h-5" />}
                        {selectedCategory === 'Team Assigned' && <Users className="w-5 h-5" />}
                        {selectedCategory === 'Field Accounts' && <Wallet className="w-5 h-5" />}
                        <h3 className="text-lg font-bold">{selectedCategory}</h3>
                      </div>
                      <p className="text-emerald-100 text-[10px] font-bold uppercase tracking-widest opacity-80">
                        {categoryProgress[selectedCategory]?.completed} of {categoryProgress[selectedCategory]?.total} tasks completed ({Math.round((categoryProgress[selectedCategory]?.completed || 0) / (categoryProgress[selectedCategory]?.total || 1) * 100)}%)
                      </p>
                    </div>
                    <div className="w-10" />
                  </div>
                )}
              </div>

              {selectedCategory && (
                <motion.div 
                  key={selectedCategory}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="space-y-4"
                >
                  {(() => {
                    const stableTrekId = getStableTrekId(selectedTrek);
                    const filteredTasks = tasks
                      .filter(t => isTaskRelatedToTrek(t, selectedTrek.id, stableTrekId) && t.category === selectedCategory);
                    
                    if (filteredTasks.length === 0) {
                      return (
                        <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-slate-200">
                          <p className="text-slate-400 text-sm font-medium">No tasks found in this category.</p>
                        </div>
                      );
                    }

                    return filteredTasks
                      .sort((a, b) => {
                        const templates = TASK_TEMPLATES[selectedCategory] || [];
                        const aIdx = templates.findIndex(t => t.title.toLowerCase().trim() === a.title.toLowerCase().trim());
                        const bIdx = templates.findIndex(t => t.title.toLowerCase().trim() === b.title.toLowerCase().trim());
                        
                        // Put unknown tasks at the end
                        if (aIdx === -1) return 1;
                        if (bIdx === -1) return -1;
                        
                        return aIdx - bIdx;
                      })
                      .map((task, idx) => (
                      <div key={task.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                      <div 
                        onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                        className="p-4 border-b border-slate-50 flex items-center justify-between bg-slate-50/50 cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-black text-emerald-600">{idx + 1}</span>
                          <div>
                            <h4 className="font-bold text-slate-800">{task.title}</h4>
                            {task.subtasks && task.subtasks.length > 0 && (
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                                {task.subtasks.filter((s: any) => 
                                  task.category === 'Transport' ? (s.make && s.registration) : s.name
                                ).length} / {task.value || 0} Filled
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            disabled={isReadOnly}
                            onClick={(e) => { e.stopPropagation(); toggleTask(task); }}
                            className={`p-1.5 rounded-lg transition-colors ${task.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'} ${isReadOnly ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <motion.div animate={{ rotate: selectedTask?.id === task.id ? 180 : 0 }}>
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          </motion.div>
                        </div>
                      </div>
                      
                      <AnimatePresence>
                        {selectedTask?.id === task.id && (
                          <motion.div 
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="p-4 space-y-4 bg-white">
                              <div className="flex items-start justify-between gap-4">
                                <p className="text-xs text-slate-500 leading-relaxed flex-1">{task.description}</p>
                                <button 
                                  disabled={isReadOnly}
                                  onClick={() => updateTaskValue(task.id, 'isNA', !task.isNA)}
                                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all ${task.isNA ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                                >
                                  {task.isNA ? 'N/A' : 'Mark N/A'}
                                </button>
                              </div>
                              
                              {task.isNA ? (
                                <div className="p-6 bg-slate-50 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
                                  <AlertCircle className="w-8 h-8 text-slate-300 mb-2" />
                                  <p className="text-xs font-bold text-slate-400">This task is marked as Not Applicable</p>
                                </div>
                              ) : (
                                <>
                                  {task.category === 'Transport' && task.type === 'number' && (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-3">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Number of vehicles:</label>
                                    <input 
                                      type="number" 
                                      min="0"
                                      disabled={isReadOnly}
                                      value={task.value || 0}
                                      onChange={(e) => {
                                        const val = Math.max(0, parseInt(e.target.value) || 0);
                                        updateTaskValue(task.id, 'value', val);
                                      }}
                                      className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                    />
                                  </div>

                                  {Array.from({ length: task.value || 0 }).map((_, vIdx) => (
                                    <div key={vIdx} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/30 space-y-3">
                                      <h5 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Vehicle {vIdx + 1}</h5>
                                      <div className="space-y-2">
                                        <select 
                                          disabled={isReadOnly}
                                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                          value={task.subtasks?.[vIdx]?.make || ''}
                                          onChange={(e) => {
                                            const newSubtasks = [...(task.subtasks || [])];
                                            newSubtasks[vIdx] = { ...(newSubtasks[vIdx] || {}), make: e.target.value };
                                            updateTaskValue(task.id, 'subtasks', newSubtasks);
                                          }}
                                        >
                                          <option value="">Select Vehicle Make...</option>
                                          {vehicles.map((v, idx) => <option key={`${v.make}-${idx}`} value={v.make}>{v.make}</option>)}
                                        </select>
                                        <input 
                                          type="text" 
                                          disabled={isReadOnly}
                                          placeholder="Vehicle Registration No."
                                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                          value={task.subtasks?.[vIdx]?.registration || ''}
                                          onChange={(e) => {
                                            const newSubtasks = [...(task.subtasks || [])];
                                            newSubtasks[vIdx] = { ...(newSubtasks[vIdx] || {}), registration: e.target.value };
                                            updateTaskValue(task.id, 'subtasks', newSubtasks);
                                          }}
                                        />
                                        <select 
                                          disabled={isReadOnly}
                                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                          value={task.subtasks?.[vIdx]?.driverName || ''}
                                          onChange={(e) => {
                                            const newSubtasks = [...(task.subtasks || [])];
                                            const selectedDriver = drivers.find(d => d.name === e.target.value);
                                            newSubtasks[vIdx] = { 
                                              ...(newSubtasks[vIdx] || {}), 
                                              driverName: e.target.value,
                                              contact: selectedDriver?.contact || newSubtasks[vIdx]?.contact || ''
                                            };
                                            updateTaskValue(task.id, 'subtasks', newSubtasks);
                                          }}
                                        >
                                          <option value="">Select Driver...</option>
                                          {drivers
                                            .filter(d => !selectedTrek?.region || normalizeRegion(d.region) === normalizeRegion(selectedTrek.region))
                                            .map((d, idx) => <option key={`${d.name}-${idx}`} value={d.name}>{d.name}</option>)}
                                        </select>
                                        <input 
                                          type="text" 
                                          disabled={isReadOnly}
                                          placeholder="Contact No."
                                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                          value={task.subtasks?.[vIdx]?.contact || ''}
                                          onChange={(e) => {
                                            const newSubtasks = [...(task.subtasks || [])];
                                            newSubtasks[vIdx] = { ...(newSubtasks[vIdx] || {}), contact: e.target.value };
                                            updateTaskValue(task.id, 'subtasks', newSubtasks);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {task.category === 'Team Assigned' && task.type === 'number' && (
                                <div className="space-y-4">
                                  <div className="flex items-center gap-3">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase">Number of {task.title}:</label>
                                    <input 
                                      type="number" 
                                      min="0"
                                      disabled={isReadOnly}
                                      value={task.value || 0}
                                      onChange={(e) => {
                                        const val = Math.max(0, parseInt(e.target.value) || 0);
                                        updateTaskValue(task.id, 'value', val);
                                      }}
                                      className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                    />
                                  </div>

                                  {Array.from({ length: task.value || 0 }).map((_, sIdx) => (
                                    <div key={sIdx} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/30 space-y-3">
                                      <h5 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                                        {task.title === 'Support Staff' ? 'Staff Member' : 
                                         task.title === 'Assistant Guides' ? 'Assistant Guide' :
                                         task.title === 'Personal Porter' ? 'Porter' :
                                         task.title.slice(0, -1)} {sIdx + 1}
                                      </h5>
                                      <div className="space-y-2">
                                        <select 
                                          disabled={isReadOnly}
                                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                          value={task.subtasks?.[sIdx]?.name || ''}
                                          onChange={(e) => {
                                            const newSubtasks = [...(task.subtasks || [])];
                                            const selectedStaff = staff.find(s => s.name === e.target.value);
                                            newSubtasks[sIdx] = { 
                                              ...(newSubtasks[sIdx] || {}), 
                                              name: e.target.value,
                                              contact: selectedStaff?.contact || newSubtasks[sIdx]?.contact || ''
                                            };
                                            updateTaskValue(task.id, 'subtasks', newSubtasks);
                                          }}
                                        >
                                          <option value="">Select Staff...</option>
                                          {staff.filter(s => s.role?.toUpperCase() !== 'COOK').map(s => <option key={s.name} value={s.name}>{s.name}</option>)
                                        }
                                        </select>
                                        <input 
                                          type="text" 
                                          disabled={isReadOnly}
                                          placeholder="Contact No."
                                          className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                          value={task.subtasks?.[sIdx]?.contact || ''}
                                          onChange={(e) => {
                                            const newSubtasks = [...(task.subtasks || [])];
                                            newSubtasks[sIdx] = { ...(newSubtasks[sIdx] || {}), contact: e.target.value };
                                            updateTaskValue(task.id, 'subtasks', newSubtasks);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {task.category !== 'Transport' && (
                                <div className="space-y-4">
                                  {task.type === 'number' && task.category !== 'Team Assigned' && (
                                    <div className="flex items-center gap-3">
                                      <label className="text-[10px] font-bold text-slate-400 uppercase">Number of {task.title.split(' ')[1] || 'items'}:</label>
                                      <input 
                                        type="number" 
                                        disabled={isReadOnly}
                                        value={task.value || 0}
                                        onChange={(e) => updateTaskValue(task.id, 'value', parseInt(e.target.value))}
                                        className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                      />
                                    </div>
                                  )}

                                  {task.type === 'amount' && (
                                    <div className="space-y-3">
                                      <div className="flex items-center gap-3">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase">Budget (₹):</label>
                                        <input 
                                          type="number" 
                                          disabled={isReadOnly || task.title === 'Total Budget'}
                                          value={task.value || 0}
                                          onChange={(e) => updateTaskValue(task.id, 'value', parseInt(e.target.value))}
                                          className="w-32 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                        />
                                      </div>
                                      {task.title !== 'Total Budget' && !isReadOnly && (
                                        <div className="space-y-2">
                                          {/* Render existing files */}
                                          {(() => {
                                            const currentFiles = task.files || (task.fileUrl ? [{ url: task.fileUrl, name: 'Voucher' }] : []);
                                            const limit = (task.category === 'Kitchen' || task.category === 'Equipment') ? 3 : 1;
                                            
                                            return (
                                              <>
                                                {/* Action Bar for Scan/Sync */}
                                                {currentFiles.length > 0 && (
                                                  <div className="flex items-center justify-between mb-2 px-1">
                                                    <div className="flex items-center gap-2">
                                                      {task.isScanned && (
                                                        <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-[9px] font-black uppercase tracking-wider border border-blue-200">
                                                          <CheckCircle2 className="w-3 h-3" />
                                                          Scanned
                                                        </div>
                                                      )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                      {isAdminMode && (
                                                        <button
                                                          onClick={() => handleScanAndSave(task)}
                                                          className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors shadow-sm"
                                                          title={currentFiles.length > 1 ? "Scan All Files" : "AI Scan & Save"}
                                                        >
                                                          <TrendingUp className="w-3 h-3" />
                                                          {currentFiles.length > 1 ? "Scan All" : "Scan"}
                                                        </button>
                                                      )}
                                                      {task.isScanned && isGoogleConnected && isAdminMode && (
                                                        <button
                                                          onClick={() => handleSyncToSheets(task)}
                                                          className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-blue-700 transition-colors shadow-sm"
                                                          title={currentFiles.length > 1 ? "Sync All to Sheets" : "Sync to Google Sheets"}
                                                        >
                                                          <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                                                          {currentFiles.length > 1 ? "Sync All" : "Sync"}
                                                        </button>
                                                      )}
                                                    </div>
                                                  </div>
                                                )}

                                                {currentFiles.map((file, fIdx) => (
                                                  <div key={fIdx} className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                                                    <div className="flex items-center gap-2 text-emerald-700">
                                                      <FileText className="w-4 h-4" />
                                                      <span className="text-xs font-bold truncate max-w-[150px]">{file.name || 'Voucher Uploaded'}</span>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                      <a 
                                                        href={file.url} 
                                                        target="_blank" 
                                                        rel="noopener noreferrer"
                                                        className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline"
                                                      >
                                                        View
                                                      </a>
                                                      {!isReadOnly && (
                                                        <button
                                                          onClick={() => handleDeleteFile(task.id, file.url)}
                                                          className="p-1 text-rose-500 hover:bg-rose-100 rounded-lg transition-colors"
                                                          title="Delete file"
                                                        >
                                                          <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                      )}
                                                    </div>
                                                  </div>
                                                ))}

                                                {/* Render upload button if limit not reached */}
                                                {currentFiles.length < limit && (
                                                  <label className={`w-full border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-all cursor-pointer ${currentFiles.length > 0 ? 'py-2' : 'py-3'}`}>
                                                    <input 
                                                      type="file" 
                                                      className="hidden" 
                                                      accept="image/*,application/pdf"
                                                      onChange={(e) => e.target.files?.[0] && handleFileUpload(task.id, e.target.files[0])}
                                                    />
                                                    {uploadingTaskId === task.id ? (
                                                      <div className="flex flex-col items-center gap-2">
                                                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                                                        <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{Math.round(uploadProgress)}%</span>
                                                      </div>
                                                    ) : (
                                                      <>
                                                        {currentFiles.length > 0 ? (
                                                          <div className="flex items-center gap-2">
                                                            <Plus className="w-4 h-4" />
                                                            <span className="text-[10px] font-bold uppercase tracking-wider">Add another file ({currentFiles.length}/{limit})</span>
                                                          </div>
                                                        ) : (
                                                          <>
                                                            <Upload className="w-4 h-4" />
                                                            <span className="text-xs font-bold uppercase tracking-wider">Upload cash voucher...</span>
                                                          </>
                                                        )}
                                                      </>
                                                    )}
                                                  </label>
                                                )}
                                              </>
                                            );
                                          })()}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {task.type === 'file' && !task.isNA && (
                                    <div className="space-y-2">
                                      {/* Render existing files */}
                                      {(() => {
                                        const currentFiles = task.files || (task.fileUrl ? [{ url: task.fileUrl, name: 'File' }] : []);
                                        const limit = (task.category === 'Kitchen' || task.category === 'Equipment') ? 3 : 1;
                                        
                                        return (
                                          <>
                                            {/* Action Bar for Scan/Sync */}
                                            {currentFiles.length > 0 && (
                                              <div className="flex items-center justify-between mb-2 px-1">
                                                <div className="flex items-center gap-2">
                                                  {task.isScanned && (
                                                    <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-[9px] font-black uppercase tracking-wider border border-blue-200">
                                                      <CheckCircle2 className="w-3 h-3" />
                                                      Scanned
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                  {isAdminMode && (
                                                    <button
                                                      onClick={() => handleScanAndSave(task)}
                                                      className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors shadow-sm"
                                                      title={currentFiles.length > 1 ? "Scan All Files" : "AI Scan & Save"}
                                                    >
                                                      <TrendingUp className="w-3 h-3" />
                                                      {currentFiles.length > 1 ? "Scan All" : "Scan"}
                                                    </button>
                                                  )}
                                                  {task.isScanned && isGoogleConnected && isAdminMode && (
                                                    <button
                                                      onClick={() => handleSyncToSheets(task)}
                                                      className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-blue-700 transition-colors shadow-sm"
                                                      title={currentFiles.length > 1 ? "Sync All to Sheets" : "Sync to Google Sheets"}
                                                    >
                                                      <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                                                      {currentFiles.length > 1 ? "Sync All" : "Sync"}
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            )}

                                            {currentFiles.map((file, fIdx) => (
                                              <div key={fIdx} className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                                                <div className="flex items-center gap-2 text-emerald-700">
                                                  <FileText className="w-4 h-4" />
                                                  <span className="text-xs font-bold truncate max-w-[150px]">{file.name || 'File Uploaded'}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                  <a 
                                                    href={file.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline"
                                                  >
                                                    View
                                                  </a>
                                                  {!isReadOnly && (
                                                    <button
                                                      onClick={() => handleDeleteFile(task.id, file.url)}
                                                      className="p-1 text-rose-500 hover:bg-rose-100 rounded-lg transition-colors"
                                                      title="Delete file"
                                                    >
                                                      <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            ))}

                                            {/* Render upload button if limit not reached */}
                                            {currentFiles.length < limit && (
                                              <label className={`w-full border-2 border-dashed border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-all cursor-pointer ${currentFiles.length > 0 ? 'py-2' : 'py-3'}`}>
                                                <input 
                                                  type="file" 
                                                  className="hidden" 
                                                  accept="image/*,application/pdf"
                                                  onChange={(e) => e.target.files?.[0] && handleFileUpload(task.id, e.target.files[0])}
                                                />
                                                {uploadingTaskId === task.id ? (
                                                  <div className="flex flex-col items-center gap-2">
                                                    <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                                                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">{Math.round(uploadProgress)}%</span>
                                                  </div>
                                                ) : (
                                                  <>
                                                    {currentFiles.length > 0 ? (
                                                      <div className="flex items-center gap-2">
                                                        <Plus className="w-4 h-4" />
                                                        <span className="text-[10px] font-bold uppercase tracking-wider">Add another file ({currentFiles.length}/{limit})</span>
                                                      </div>
                                                    ) : (
                                                      <>
                                                        <Upload className="w-4 h-4" />
                                                        <span className="text-xs font-bold uppercase tracking-wider">Choose file...</span>
                                                      </>
                                                    )}
                                                  </>
                                                )}
                                              </label>
                                            )}
                                          </>
                                        );
                                      })()}
                                    </div>
                                  )}

                                  {task.type === 'select' && (
                                    <div className="space-y-3">
                                      <select 
                                        disabled={isReadOnly}
                                        value={task.value || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          updateTaskValue(task.id, 'value', val);
                                          // Auto-populate contact for Trip Leader or any Team Assigned select
                                          if (task.category === 'Team Assigned') {
                                            const selectedStaff = staff.find(s => s.name === val);
                                            if (selectedStaff) {
                                              updateTaskValue(task.id, 'contact', selectedStaff.contact);
                                            }
                                          }
                                        }}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 appearance-none disabled:opacity-50"
                                      >
                                        <option value="">Select {task.title}...</option>
                                        {task.category === 'Team Assigned' && task.title === 'Cook' 
                                          ? staff.filter(s => s.role?.toUpperCase() === 'COOK').map(s => <option key={s.name} value={s.name}>{s.name}</option>)
                                          : task.category === 'Team Assigned' && task.title === 'Horseman'
                                          ? staff.filter(s => s.role?.toUpperCase().includes('HORSEMAN') && (!selectedTrek?.region || normalizeRegion(s.region) === normalizeRegion(selectedTrek.region))).map(s => <option key={s.name} value={s.name}>{s.name}</option>)
                                          : task.category === 'Team Assigned' && task.title === 'Trip Leader'
                                          ? staff.filter(s => s.role?.toUpperCase() !== 'COOK').map(s => <option key={s.name} value={s.name}>{s.name}</option>)
                                          : task.options?.map(opt => <option key={opt} value={opt}>{opt}</option>)
                                        }
                                      </select>
                                      <input 
                                        type="text" 
                                        disabled={isReadOnly}
                                        placeholder="Contact No."
                                        value={task.contact || ''}
                                        onChange={(e) => updateTaskValue(task.id, 'contact', e.target.value)}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                                
                              {!isReadOnly && (
                                  <div className="pt-4 border-t border-slate-100 flex justify-end">
                                    <button
                                      onClick={() => toggleTask(task)}
                                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                                        task.status === 'completed'
                                          ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                                          : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-200'
                                      }`}
                                    >
                                      {task.status === 'completed' ? (
                                        <>
                                          <CheckCircle2 className="w-4 h-4" />
                                          Completed
                                        </>
                                      ) : (
                                        <>
                                          <CheckCircle2 className="w-4 h-4" />
                                          Mark as Complete
                                        </>
                                      )}
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                      </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  ))})()}
                </motion.div>
              )}
            </motion.div>
          )}

          {view === 'team' && (
            <motion.div 
              key="team"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <h2 className="text-2xl font-bold px-1">Operations Team</h2>
              <div className="grid gap-4">
                {/* Team members would be fetched from Firestore in a real app */}
                <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold">AS</div>
                    <div>
                      <h3 className="font-bold text-slate-800">Arjun Singh</h3>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ground Ops</p>
                    </div>
                  </div>
                  <ChevronRight className="w-6 h-6 text-slate-300" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Admin Passcode Modal */}
      <AnimatePresence>
        {isAdminModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-xs bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8"
            >
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-50 rounded-3xl flex items-center justify-center text-emerald-600 mb-2">
                  <Lock className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-800">Admin Access</h3>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Enter Passcode</p>
                </div>
                
                <div className="w-full space-y-4 pt-4">
                  <div className="relative">
                    <input 
                      type="password"
                      value={adminPasscode}
                      onChange={(e) => {
                        setAdminPasscode(e.target.value);
                        setAdminPasscodeError(false);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminAuth()}
                      placeholder="••••"
                      className={`w-full bg-slate-50 border-2 rounded-2xl px-6 py-4 text-center text-2xl tracking-[1em] font-bold outline-none transition-all ${
                        adminPasscodeError ? 'border-rose-200 text-rose-500 animate-shake' : 'border-slate-100 focus:border-emerald-500 text-slate-800'
                      }`}
                      autoFocus
                    />
                    {adminPasscodeError && (
                      <p className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mt-2">Incorrect Passcode</p>
                    )}
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={() => setIsAdminModalOpen(false)}
                      className="flex-1 py-4 text-sm font-bold text-slate-400 hover:bg-slate-50 rounded-2xl transition-colors"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleAdminAuth}
                      className="flex-1 bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-100 active:scale-[0.98] transition-all"
                    >
                      Verify
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Scan Results Modal */}
      <AnimatePresence>
        {isScanModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isScanning && setIsScanModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-8 border-b border-slate-100 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                      <TrendingUp className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-800">AI Data Extraction</h3>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Scanning: {scanningTask?.title}</p>
                    </div>
                  </div>
                  {!isScanning && (
                    <button 
                      onClick={() => setIsScanModalOpen(false)}
                      className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                {isScanning ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-6">
                    <div className="relative">
                      <div className="w-16 h-16 border-4 border-emerald-100 rounded-full" />
                      <div className="absolute inset-0 w-16 h-16 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm font-bold text-slate-800 uppercase tracking-wider">Gemini is reading your list...</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Converting image to structured data</p>
                    </div>
                  </div>
                ) : scanError ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center text-rose-500">
                      <AlertCircle className="w-8 h-8" />
                    </div>
                    <div className="text-center space-y-2">
                      <p className="text-sm font-bold text-slate-800 uppercase tracking-wider">Extraction Failed</p>
                      <p className="text-xs text-slate-500 max-w-[280px] mx-auto leading-relaxed">{scanError}</p>
                    </div>
                    <button 
                      onClick={() => handleScanAndSave(scanningTask!)}
                      className="mt-4 px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold uppercase tracking-widest transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                ) : scanResults ? (
                  <div className="space-y-6">
                    <div className="bg-emerald-50/50 border border-emerald-100 rounded-2xl p-4 flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-800 leading-relaxed">
                        <b>Scan Complete!</b> Gemini has extracted the following items. Please verify the details before saving to the database.
                      </p>
                    </div>

                    <div className="overflow-hidden border border-slate-100 rounded-2xl">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Item</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Qty</th>
                            <th className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {scanResults.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-4 py-3 text-sm font-medium text-slate-700">{row.item}</td>
                              <td className="px-4 py-3 text-sm font-bold text-slate-600 text-center">{row.quantity}</td>
                              <td className="px-4 py-3 text-sm font-mono text-slate-500 text-right">
                                {row.unit_price ? `₹${row.unit_price}` : '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">No data extracted</p>
                  </div>
                )}
              </div>

              <div className="p-8 border-t border-slate-100 bg-slate-50/50 shrink-0 flex gap-4">
                <button 
                  disabled={isScanning}
                  onClick={() => setIsScanModalOpen(false)}
                  className="flex-1 py-4 text-sm font-bold text-slate-400 hover:bg-slate-100 rounded-2xl transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  disabled={isScanning || !scanResults}
                  onClick={handleConfirmScan}
                  className="flex-[2] bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-100 active:scale-[0.98] transition-all disabled:opacity-50 disabled:shadow-none flex flex-col items-center justify-center gap-0.5"
                >
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    Save to Database
                  </div>
                  {isGoogleConnected && (
                    <span className="text-[9px] opacity-80 font-medium uppercase tracking-widest">+ Sync to Google Sheets</span>
                  )}
                </button>
              </div>
              
              {!isGoogleConnected && (
                <div className="px-8 pb-8">
                  <button 
                    onClick={handleConnectGoogle}
                    className="w-full py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors"
                  >
                    <img src="https://www.gstatic.com/images/branding/product/1x/gdrive_48dp.png" className="w-4 h-4" alt="Drive" />
                    Connect Google Drive to Sync Sheets
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Create Trek Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="relative bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h3 className="text-xl font-bold">New Trek Planning</h3>
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 p-1"><X className="w-6 h-6" /></button>
              </div>
              <form onSubmit={handleCreateTrek} className="p-6 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Trek Name</label>
                  <input required type="text" placeholder="e.g. Valley of Flowers" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={newTrek.name} onChange={e => setNewTrek({...newTrek, name: e.target.value})} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Type</label>
                    <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none appearance-none" value={newTrek.type} onChange={e => setNewTrek({...newTrek, type: e.target.value as TrekType})}>
                      <option value="Trek">Trek</option>
                      <option value="Expedition">Expedition</option>
                      <option value="Climb">Climb</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Region</label>
                    <select className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none appearance-none" value={newTrek.region} onChange={e => setNewTrek({...newTrek, region: e.target.value})}>
                      {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Start Date</label>
                    <input required type="date" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={newTrek.startDate} onChange={e => setNewTrek({...newTrek, startDate: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">End Date</label>
                    <input required type="date" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={newTrek.endDate} onChange={e => setNewTrek({...newTrek, endDate: e.target.value})} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Pax</label>
                    <input required type="number" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={newTrek.pax} onChange={e => setNewTrek({...newTrek, pax: parseInt(e.target.value)})} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Location</label>
                    <input required type="text" placeholder="e.g. Everest Region" className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" value={newTrek.location} onChange={e => setNewTrek({...newTrek, location: e.target.value})} />
                  </div>
                </div>
                <button type="submit" className="w-full bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-[0.98] mt-4">Initialize Planning</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSalesModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsSalesModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} className="relative bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 text-emerald-600 rounded-xl">
                    <Search className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Import from Sales</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      setIsLoadingSales(false);
                      setIsImporting(false);
                      setSalesError(null);
                      loadSalesData();
                    }}
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                    title="Reset & Refresh"
                  >
                    <RefreshCw className={`w-5 h-5 ${isLoadingSales ? 'animate-spin' : ''}`} />
                  </button>
                  <button onClick={() => setIsSalesModalOpen(false)} className="text-slate-400 p-1 hover:bg-slate-100 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between mb-6 bg-slate-50 p-3 rounded-2xl">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="selectAll"
                    checked={(() => {
                      const visibleTrips = salesTrips.filter(trip => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const isPast = new Date(trip.endDate) < today;
                        return showCompletedSales ? true : !isPast;
                      });
                      return visibleTrips.length > 0 && visibleTrips.every(t => selectedSalesTrips.includes(t.id));
                    })()}
                    onChange={() => {
                      const visibleTrips = salesTrips.filter(trip => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        const isPast = new Date(trip.endDate) < today;
                        return showCompletedSales ? true : !isPast;
                      });
                      const allVisibleSelected = visibleTrips.every(t => selectedSalesTrips.includes(t.id));
                      if (allVisibleSelected) {
                        setSelectedSalesTrips(prev => prev.filter(id => !visibleTrips.some(vt => vt.id === id)));
                      } else {
                        setSelectedSalesTrips(prev => [...new Set([...prev, ...visibleTrips.map(t => t.id)])]);
                      }
                    }}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="selectAll" className="text-xs font-bold text-slate-600 uppercase tracking-wider cursor-pointer">
                    Select All <span className="text-slate-400 ml-1">({selectedSalesTrips.length} selected)</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="showCompletedSales"
                    checked={showCompletedSales}
                    onChange={() => setShowCompletedSales(!showCompletedSales)}
                    className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="showCompletedSales" className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer">
                    Show Completed Treks
                  </label>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto -mx-2 px-2 space-y-3">
                {salesError && (
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl mb-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-bold text-rose-600 uppercase tracking-wider">{salesError}</p>
                    </div>
                    <button 
                      onClick={() => loadSalesData()}
                      className="w-full py-2 bg-rose-100 text-rose-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-rose-200 transition-colors"
                    >
                      Try Again
                    </button>
                  </div>
                )}
                {isFirestoreOffline && (
                  <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl mb-4 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">Firestore Unreachable</p>
                      <p className="text-[10px] text-amber-500 mt-1">
                        The app is having trouble connecting to the database. Imports may fail.
                      </p>
                    </div>
                  </div>
                )}
                {isLoadingSales ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Fetching from Google Sheets...</p>
                  </div>
                ) : (salesTrips.length === 0 && !salesError) ? (
                  <div className="text-center py-12">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">No open treks found in Sheet7</p>
                  </div>
                ) : (
                  salesTrips
                    .filter(trip => {
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const tripEndDate = parseTrekDate(trip.endDate);
                      const isPast = tripEndDate < today;
                      return showCompletedSales ? true : !isPast;
                    })
                    .map(trip => {
                      const tripDateStr = getTrekDateString(trip.startDate);
                      const exists = treks.some(t => {
                        const tDateStr = getTrekDateString(t.startDate);
                        return t.name.toLowerCase().trim() === trip.name.toLowerCase().trim() && tDateStr === tripDateStr;
                      });
                      const isSelected = selectedSalesTrips.includes(trip.id);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      
                      const tripStartDate = parseTrekDate(trip.startDate);
                      const tripEndDate = parseTrekDate(trip.endDate);
                      
                      const isCompleted = tripEndDate < today;
                      const isStarted = tripStartDate < today;
                      const isActive = isStarted && !isCompleted;

                      return (
                        <div 
                          key={trip.id} 
                          onClick={() => !exists && setSelectedSalesTrips(prev => isSelected ? prev.filter(id => id !== trip.id) : [...prev, trip.id])}
                          className={`p-4 rounded-3xl border transition-all relative ${
                            exists ? 'opacity-60 bg-slate-50 border-slate-100 cursor-not-allowed' : 
                            isSelected ? 'border-emerald-500 bg-emerald-50/30' : 'border-slate-100 bg-white hover:border-slate-200 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-start gap-4">
                            <div className={`mt-1 w-5 h-5 rounded-lg border flex items-center justify-center transition-colors ${
                              isSelected ? 'bg-emerald-600 border-emerald-600' : 'border-slate-300 bg-white'
                            }`}>
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="font-bold text-slate-800 leading-tight">{trip.name}</h4>
                                {exists && (
                                  <span className="flex items-center gap-1 text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-1 rounded-lg uppercase tracking-wider border border-amber-100">
                                    <AlertCircle className="w-3 h-3" /> Already exists
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                                  <Calendar className="w-3 h-3" />
                                  <span>{formatDate(trip.startDate)} - {formatDate(trip.endDate)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase">
                                  <Users className="w-3 h-3" />
                                  <span>{trip.pax} sign ups</span>
                                </div>
                                <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
                                  trip.region === 'Nepal' ? 'bg-blue-50 text-blue-600' :
                                  trip.region === 'Sikkim' ? 'bg-rose-50 text-rose-600' :
                                  trip.region === 'Bhutan' ? 'bg-green-50 text-green-600' :
                                  'bg-slate-50 text-slate-600'
                                }`}>
                                  {trip.region}
                                </span>
                                {isCompleted && (
                                  <span className="text-[9px] font-black bg-slate-100 text-slate-400 px-2 py-0.5 rounded-md uppercase tracking-wider">Completed</span>
                                )}
                                {isActive && (
                                  <span className="text-[9px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-md uppercase tracking-wider">Active</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-slate-100 flex gap-3">
                <button 
                  onClick={() => setIsSalesModalOpen(false)}
                  className="flex-1 px-6 py-4 rounded-2xl text-sm font-bold text-slate-400 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  disabled={selectedSalesTrips.length === 0 || isLoadingSales || isImporting}
                  onClick={handleImportSales}
                  className="flex-[2] bg-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-emerald-100 disabled:opacity-50 disabled:shadow-none transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import Selected (${selectedSalesTrips.length})`
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Nav Removed */}
      
      {/* Debug Overlay */}
      {showDebug && (
        <div className="fixed bottom-4 right-4 z-[100] w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[400px]">
          <div className="p-3 bg-slate-900 text-white flex justify-between items-center">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-bold uppercase tracking-wider">Debug Console</span>
            </div>
            <button onClick={() => setShowDebug(false)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
              <div className="text-[9px] font-bold text-slate-400 uppercase">Environment</div>
              <div className="text-[10px] font-mono text-slate-600 break-all">UID: {user?.uid}</div>
              <div className="text-[10px] font-mono text-slate-600 break-all">DB: {dbId}</div>
              <div className="text-[10px] font-mono text-slate-600 flex items-center gap-1">
                Backend: 
                {backendStatus ? (
                  <span className="text-emerald-600 font-bold">ONLINE</span>
                ) : (
                  <span className="text-rose-600 font-bold">OFFLINE</span>
                )}
              </div>
              {backendStatus && (
                <div className="text-[8px] text-slate-400">
                  Last: {new Date(backendStatus.last_startup).toLocaleTimeString()}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[9px] font-bold text-slate-400 uppercase">Logs</div>
              <button 
                onClick={async () => {
                  try {
                    const res = await fetch('/api/debug/clear', { method: 'POST' });
                    if (!res.ok) {
                      const errText = await res.text();
                      throw new Error(errText);
                    }
                    setDebugLogs([]);
                    alert("Logs cleared successfully!");
                  } catch (e: any) {
                    console.error("Failed to clear logs:", e);
                    alert("Failed to clear logs: " + e.message);
                  }
                }}
                className="text-[9px] text-rose-500 hover:text-rose-600 font-bold"
              >
                Clear
              </button>
            </div>
            {debugLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs italic">No logs found yet...</div>
            ) : (
              debugLogs.map((log: any) => (
                <div key={log.id} className="p-2 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-[10px] font-bold text-slate-800">{log.message}</div>
                  <div className="text-[9px] text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</div>
                  {log.data && (
                    <pre className="text-[8px] mt-1 bg-white p-1 rounded border border-slate-200 overflow-x-auto">
                      {JSON.stringify(log.data, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="p-2 bg-slate-50 border-t border-slate-200 space-y-2">
            <button 
              onClick={async () => {
                if (!user) return;
                console.log("Testing Firestore write...");
                try {
                  await setDoc(doc(db, "users", user.uid), { lastTest: new Date().toISOString() }, { merge: true });
                  console.log("Firestore write test successful!");
                  alert("✅ Firestore Write: SUCCESS");
                } catch (e) {
                  console.error("Firestore write test failed:", e);
                  alert(`❌ Firestore Write: FAILED\n${e instanceof Error ? e.message : 'Unknown error'}`);
                }
              }}
              className="w-full py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-bold hover:bg-emerald-700 transition-colors shadow-sm"
            >
              Test Firestore Write
            </button>
            <button 
              onClick={() => checkGoogleStatus()}
              className="w-full py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-bold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Force Status Check
            </button>
          </div>
        </div>
      )}

      {/* Debug Toggle (Hidden trigger removed, now using header button) */}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <TrekOpsApp />
    </ErrorBoundary>
  );
}
