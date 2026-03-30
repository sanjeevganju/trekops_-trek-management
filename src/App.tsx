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
  ExternalLink,
  Cloud
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
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
  deleteObject
} from 'firebase/storage';
import { GoogleGenAI, Type } from "@google/genai";
import { db, auth, storage } from './firebase';
import { TASK_TEMPLATES, TrekType, Category, TaskTemplate, REGIONS } from './constants';
import { formatDate, formatDeadline, isOverdue } from './utils';
import { fetchStaffList, StaffMember } from './services/staffService';
import { fetchSalesTrips, SalesTrip } from './services/salesService';
import { fetchDrivers, fetchVehicles, Driver, Vehicle } from './services/transportService';

// --- Error Handling ---
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
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let message = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error.includes('insufficient permissions')) {
          message = "You don't have permission to perform this action.";
        }
      } catch (e) {
        // Not a JSON error
      }
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50">
          <div className="bg-rose-50 p-4 rounded-full mb-4">
            <AlertCircle className="w-12 h-12 text-rose-500" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Oops!</h2>
          <p className="text-slate-500 mb-6 max-w-xs">{message}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-emerald-600 text-white font-bold px-8 py-3 rounded-2xl shadow-lg shadow-emerald-200"
          >
            Reload App
          </button>
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

  const getTrekProgress = (trekId: string) => {
    const trekTasks = tasks.filter(t => t.trekId === trekId);
    if (trekTasks.length === 0) return { percent: 0, color: 'bg-rose-500' };
    
    const completedTasks = trekTasks.filter(t => t.status === 'completed' || t.isNA).length;
    const percent = Math.round((completedTasks / trekTasks.length) * 100);
    
    if (percent === 100) return { percent, color: 'bg-emerald-500' };
    if (percent >= 75) return { percent, color: 'bg-blue-500' };
    if (percent >= 50) return { percent, color: 'bg-yellow-400' };
    if (percent >= 25) return { percent, color: 'bg-orange-500' };
    return { percent, color: 'bg-rose-500' };
  };
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSalesModalOpen, setIsSalesModalOpen] = useState(false);
  const [isCleanupModalOpen, setIsCleanupModalOpen] = useState(false);
  const [cleanupData, setCleanupData] = useState<{ duplicates: TrekInstance[], status: 'idle' | 'scanning' | 'found' | 'deleting' | 'done', log: string[] }>({ duplicates: [], status: 'idle', log: [] });
  const [selectedSalesTrips, setSelectedSalesTrips] = useState<string[]>([]);
  const [newTrek, setNewTrek] = useState({ name: '', type: 'Trek' as TrekType, startDate: '', endDate: '', pax: 2, region: 'Nepal', location: '' });
  const [typeFilter, setTypeFilter] = useState<TrekType | 'All'>('All');
  const [showCompleted, setShowCompleted] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [salesTrips, setSalesTrips] = useState<SalesTrip[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoadingSales, setIsLoadingSales] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [showCompletedSales, setShowCompletedSales] = useState(false);

  const [isFirestoreOffline, setIsFirestoreOffline] = useState(false);
  const [isTreksLoading, setIsTreksLoading] = useState(true);
  const [treksError, setTreksError] = useState<string | null>(null);
  const [showFactoryResetConfirm, setShowFactoryResetConfirm] = useState(false);
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

  const checkGoogleStatus = async () => {
    setIsRefreshingStatus(true);
    console.log('Manually checking Google status...');
    try {
      const res = await fetch('/api/google/status', { credentials: 'include' });
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

  const handleConnectGoogle = async () => {
    try {
      const res = await fetch('/api/auth/google/url', { credentials: 'include' });
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
      
      // Start polling for status since postMessage can be unreliable in some browsers
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const connected = await checkGoogleStatus();
        if (connected || attempts > 20) {
          clearInterval(interval);
        }
      }, 2000);
    } catch (error) {
      console.error("Failed to get Google auth URL:", error);
      alert(`Connection Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleSyncToSheets = async (task: Task) => {
    if (!isGoogleConnected || !selectedTrek) return;
    
    try {
      setIsScanning(true);
      // Fetch the extracted data from Firestore for this task
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
        await getDocFromServer(doc(db, 'test', 'connection'));
        setIsFirestoreOffline(false);
        console.log('Firestore connection test successful.');
      } catch (error) {
        if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('Could not reach Cloud Firestore backend'))) {
          console.error("Firestore is offline or unreachable.");
          setIsFirestoreOffline(true);
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
    if (!isAuthReady || !user || !selectedTrek) return;

    const q = query(
      collection(db, 'tasks'), 
      where('trekId', '==', selectedTrek.id)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(taskData);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });

    return () => unsubscribe();
  }, [isAuthReady, user, selectedTrek]);

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
    if (!date) return new Date(0);
    
    // Handle Firestore Timestamp
    if (typeof date === 'object' && date !== null && 'seconds' in date) {
      return new Date(date.seconds * 1000);
    }
    if (date.toDate && typeof date.toDate === 'function') {
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
          [year, month, day] = [day, month, day];
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
  };

  const filteredTreks = useMemo(() => {
    let filtered = treks;
    if (selectedRegion) {
      filtered = filtered.filter(t => t.region === selectedRegion);
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
          await updateTaskValue(taskId, 'fileUrl', downloadURL);
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
      // Create a reference to the file to delete
      const fileRef = ref(storage, fileUrl);
      
      // Delete the file from storage
      await deleteObject(fileRef);
      
      // Update the task in Firestore
      await updateTaskValue(taskId, 'fileUrl', null);
      
      console.log('File deleted successfully');
    } catch (error) {
      console.error('Error deleting file:', error);
      // Even if storage delete fails (e.g. file already gone), we still want to clear the reference in Firestore
      await updateTaskValue(taskId, 'fileUrl', null);
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
    if (!task.fileUrl) return;
    
    setIsScanning(true);
    setScanningTask(task);
    setScanResults(null);
    setScanError(null);
    setIsScanModalOpen(true);

    try {
      setIsScanning(true);
      setScanError(null);
      setScanResults(null);

      // 1. Send the file URL to our backend for extraction
      const response = await fetch('/api/extract-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: task.fileUrl })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to extract data from image.');
      }

      const { data } = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('No items were found in the image.');
      }
      
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

  const handleFixDatabase = async () => {
    try {
      const taskPromises: Promise<any>[] = [];
      const trekPromises: Promise<any>[] = [];
      const categories: Category[] = ['Transport', 'Permits', 'Equipment', 'Kitchen', 'Team Assigned', 'Field Accounts'];
      
      // Fetch ALL tasks to avoid resetting progress on other treks
      const allTasksSnapshot = await getDocs(collection(db, 'tasks'));
      const allTasks = allTasksSnapshot.docs.map(d => d.data() as Task);

      for (const trek of treks) {
        // Normalize region if needed
        const normalizedRegion = normalizeRegion(trek.region);
        if (normalizedRegion !== trek.region) {
          trekPromises.push(updateDoc(doc(db, 'treks', trek.id), { region: normalizedRegion }));
        }

        const trekTasks = allTasks.filter(t => t.trekId === trek.id);
        
        categories.forEach(category => {
          const categoryTasks = trekTasks.filter(t => t.category === category);
          const templates = TASK_TEMPLATES[category] || [];
          
          templates.forEach(template => {
            const exists = categoryTasks.some(t => t.title === template.title);
            if (!exists) {
              // Generate Stable ID for tasks: task-[trek-id]-[task-title-slug]
              const taskNameSlug = template.title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
              const taskStableId = `task-${trek.id}-${taskNameSlug}`;

              taskPromises.push(setDoc(doc(db, 'tasks', taskStableId), {
                id: taskStableId,
                trekId: trek.id,
                category,
                ...template,
                status: 'pending',
                createdAt: serverTimestamp()
              }));
            }
          });
        });
      }
      
      if (taskPromises.length > 0 || trekPromises.length > 0) {
        await Promise.all([...taskPromises, ...trekPromises]);
        setSalesError(`Successfully fixed ${trekPromises.length} regions and added ${taskPromises.length} missing tasks.`);
      } else {
        setSalesError('Database is already up to date.');
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'database/fix');
    }
  };

  const deleteTrek = async (trekId: string) => {
    // window.confirm is blocked in the iframe, so we'll proceed directly.
    // In a real app, we'd use a custom modal for this.
    try {
      // Delete trek
      await deleteDoc(doc(db, 'treks', trekId));
      
      // Delete associated tasks
      const trekTasks = tasks.filter(t => t.trekId === trekId);
      const deletePromises = trekTasks.map(t => deleteDoc(doc(db, 'tasks', t.id)));
      await Promise.all(deletePromises);
      
      setSelectedTrek(null);
      setView('dashboard');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `treks/${trekId}`);
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

  const normalizeRegion = (region: string): string => {
    if (!region) return 'Nepal';
    const r = region.toUpperCase().trim().replace(/_/g, ' ');
    if (r.includes('HIMACHAL')) return 'Himachal';
    if (r.includes('UTTARAKHAND')) return 'Uttarakhand';
    if (r.includes('LADAKH')) return 'Ladakh';
    if (r.includes('KASHMIR')) return 'Kashmir';
    if (r.includes('SIKKIM')) return 'Sikkim';
    if (r.includes('BHUTAN')) return 'Bhutan';
    if (r.includes('NEPAL')) return 'Nepal';
    
    // Default to Title Case if not matched
    return region.charAt(0).toUpperCase() + region.slice(1).toLowerCase();
  };

  const handleCreateTrek = async (e?: React.FormEvent, tripData?: SalesTrip) => {
    if (e) e.preventDefault();
    const data = tripData || newTrek;
    
    // Normalize region
    const normalizedRegion = normalizeRegion(data.region);
    
    // Generate Stable ID: trek-[name-slug]-[date]
    // This ensures that the same trek on the same date always has the same ID, preventing duplicates.
    const trekNameSlug = data.name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const trekDateStr = getTrekDateString(data.startDate);
    const stableId = `trek-${trekNameSlug}-${trekDateStr}`;
    
    try {
      console.log(`Creating/Updating trek with stable ID: ${stableId}`);
      
      // Use setDoc instead of addDoc for stable IDs
      await setDoc(doc(db, 'treks', stableId), {
        ...data,
        region: normalizedRegion,
        id: stableId, // Ensure ID is stored in the document too
        status: 'active',
        createdAt: serverTimestamp(),
        createdBy: user?.uid
      });

      const categories: Category[] = ['Transport', 'Permits', 'Equipment', 'Kitchen', 'Team Assigned', 'Field Accounts'];
      const taskPromises: Promise<any>[] = [];

      categories.forEach(category => {
        const templates = TASK_TEMPLATES[category] || [];
        templates.forEach(template => {
          // Generate Stable ID for tasks too: task-[trek-id]-[task-title-slug]
          const taskNameSlug = template.title.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          const taskStableId = `task-${stableId}-${taskNameSlug}`;
          
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

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Force account selection to help with multi-account issues
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error('Login Error:', error);
      if (error.code === 'auth/popup-blocked') {
        alert("The login popup was blocked by your browser. Please allow popups or use the 'Open in New Tab' button below.");
      } else if (error.code === 'auth/cancelled-by-user') {
        // Ignore
      } else {
        setTreksError(`Login failed: ${error.message}. Try using the 'Open in New Tab' button below.`);
      }
    }
  };

  const handleScanDuplicates = () => {
    console.log('Starting duplicate scan...');
    setCleanupData({ duplicates: [], status: 'scanning', log: ['Starting scan...'] });
    setIsCleanupModalOpen(true);
    
    setTimeout(() => {
      const seen = new Map<string, TrekInstance>();
      const duplicates: TrekInstance[] = [];
      const logs: string[] = ['Scanning for duplicates...'];
      
      console.log(`Current state treks count: ${treks.length}`);
      if (treks.length > 0) {
        console.table(treks.map(t => ({ id: t.id, name: t.name, startDate: getTrekDateString(t.startDate) })));
      }

      const sortedTreks = [...treks].sort((a, b) => {
        const dateA = parseTrekDate(a.startDate).getTime();
        const dateB = parseTrekDate(b.startDate).getTime();
        
        // Handle invalid dates in sort
        const timeA = isNaN(dateA) ? 0 : dateA;
        const timeB = isNaN(dateB) ? 0 : dateB;
        
        if (timeA !== timeB) return timeA - timeB;
        
        const createA = a.createdAt?.toMillis?.() || 0;
        const createB = b.createdAt?.toMillis?.() || 0;
        return createA - createB;
      });

      console.log(`Scanning ${sortedTreks.length} sorted treks...`);

      sortedTreks.forEach(trek => {
        const dateStr = getTrekDateString(trek.startDate);
        const nameKey = trek.name.toLowerCase().trim();
        
        // Safety: If name is empty, don't mark as duplicate based on date alone
        if (!nameKey) {
          console.log(`Skipping trek with no name: ${trek.id}`);
          return;
        }

        const key = `${nameKey}-${dateStr}`;
        console.log(`Scanning trek: "${trek.name}" ID: ${trek.id} Key: ${key}`);
        
        if (seen.has(key)) {
          const original = seen.get(key);
          console.log(`Found duplicate: "${trek.name}" (${dateStr}). Keeping ID: ${original?.id}, Marking ID: ${trek.id}`);
          duplicates.push(trek);
        } else {
          console.log(`First encounter: "${trek.name}" (${dateStr}). ID: ${trek.id}`);
          seen.set(key, trek);
        }
      });

      console.log(`Scan complete. Found ${duplicates.length} duplicates. Unique: ${seen.size}`);
      
      if (seen.size === 0 && treks.length > 0) {
        console.error('CRITICAL: Scan resulted in 0 unique treks but input had treks. Aborting.');
        setCleanupData(prev => ({ 
          ...prev, 
          status: 'done', 
          log: [...logs, 'ERROR: Scan resulted in 0 unique treks. This is a bug in the scan logic. Aborting to prevent data loss.'] 
        }));
        return;
      }

      if (duplicates.length >= treks.length && treks.length > 0) {
        console.error('CRITICAL: Scan marked ALL treks as duplicates. Aborting.');
        setCleanupData(prev => ({ 
          ...prev, 
          status: 'done', 
          log: [...logs, `ERROR: Scan marked all ${treks.length} treks as duplicates. This is unsafe. Aborting.`] 
        }));
        return;
      }

      setCleanupData(prev => ({ 
        ...prev, 
        duplicates, 
        status: 'found', 
        log: [...logs, `Scan complete. Found ${duplicates.length} duplicates out of ${treks.length} total treks.`, `Unique treks to keep: ${seen.size}`] 
      }));
    }, 800);
  };

  const handleExecuteCleanup = async () => {
    if (cleanupData.status !== 'found' || cleanupData.duplicates.length === 0) return;
    
    console.log(`Cleanup execution started. Current treks in state: ${treks.length}`);
    
    // FINAL VERIFICATION: Re-run the scan logic on the CURRENT treks state to be 100% safe
    const seen = new Map<string, TrekInstance>();
    const finalDuplicates: TrekInstance[] = [];
    const finalToKeep: TrekInstance[] = [];

    treks.forEach(trek => {
      const dateStr = getTrekDateString(trek.startDate);
      const nameKey = trek.name?.trim().toLowerCase();
      
      if (!nameKey) {
        console.warn(`Trek ${trek.id} has no name. Keeping it for safety.`);
        finalToKeep.push(trek);
        return;
      }
      
      const key = `${nameKey}-${dateStr}`;
      
      if (seen.has(key)) {
        console.log(`Final check: Marking ${trek.id} ("${trek.name}") as duplicate of ${seen.get(key)?.id}`);
        finalDuplicates.push(trek);
      } else {
        console.log(`Final check: Keeping ${trek.id} ("${trek.name}") as the unique instance.`);
        seen.set(key, trek);
        finalToKeep.push(trek);
      }
    });

    console.log(`Final Verification Summary: ${finalDuplicates.length} to delete, ${finalToKeep.length} to keep.`);

    if (finalToKeep.length === 0 && treks.length > 0) {
      const msg = "CRITICAL SAFETY ABORT: Final verification resulted in 0 unique treks. Aborting deletion to prevent data loss.";
      console.error(msg);
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `ERROR: ${msg}`], status: 'done' }));
      return;
    }

    // Hard limit: Don't delete more than 500 treks in one go
    if (finalDuplicates.length > 500) {
      const msg = `Safety limit: Cleanup tried to delete ${finalDuplicates.length} treks. The limit is 500 per run.`;
      console.error(msg);
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `ERROR: ${msg}`], status: 'done' }));
      return;
    }

    setCleanupData(prev => ({ ...prev, status: 'deleting', log: [...prev.log, `Verified: Deleting ${finalDuplicates.length} duplicates, keeping ${finalToKeep.length} unique treks.`] }));
    
    try {
      const duplicateIds = finalDuplicates.map(t => t.id);
      console.log('IDs to delete:', duplicateIds);
      const allTaskRefs: any[] = [];
      
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `Step 1: Fetching tasks for ${duplicateIds.length} duplicate treks...`] }));
      
      // Fetch tasks in chunks to avoid Firestore limits
      const chunkedIds = [];
      for (let i = 0; i < duplicateIds.length; i += 30) {
        chunkedIds.push(duplicateIds.slice(i, i + 30));
      }

      for (const chunk of chunkedIds) {
        const tasksQuery = query(collection(db, 'tasks'), where('trekId', 'in', chunk));
        const tasksSnapshot = await getDocs(tasksQuery);
        tasksSnapshot.docs.forEach(d => allTaskRefs.push(d.ref));
      }
      
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `Step 2: Found ${allTaskRefs.length} tasks to remove.`] }));

      const allRefsToDelete = [
        ...allTaskRefs,
        ...duplicateIds.map(id => doc(db, 'treks', id))
      ];
      console.log(`Total refs to delete: ${allRefsToDelete.length} (${allTaskRefs.length} tasks, ${duplicateIds.length} treks)`);

      const namesToDelete = finalDuplicates.map(t => `"${t.name}" (${getTrekDateString(t.startDate)})`).join(', ');
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `Step 3: Executing ${allRefsToDelete.length} total delete operations...`, `Deleting: ${namesToDelete.substring(0, 200)}${namesToDelete.length > 200 ? '...' : ''}`] }));

      // Execute in batches of 500 (Firestore limit)
      let deletedCount = 0;
      for (let i = 0; i < allRefsToDelete.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = allRefsToDelete.slice(i, i + 500);
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
        deletedCount += chunk.length;
        setCleanupData(prev => ({ ...prev, log: [...prev.log, `Batch ${Math.floor(i/500) + 1} complete (${chunk.length} items). Total deleted: ${deletedCount}`] }));
      }

      setCleanupData(prev => ({ 
        ...prev, 
        duplicates: [], 
        status: 'done', 
        log: [...prev.log, `SUCCESS: Removed ${duplicateIds.length} treks and ${allTaskRefs.length} tasks.`, `Total unique treks remaining: ${finalToKeep.length}`] 
      }));
      
      // Force a local state update to show results immediately
      setTreks(finalToKeep);
      
      // Reload after a short delay to ensure everything is fresh
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error: any) {
      console.error('Cleanup Error:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `ERROR: ${errorMsg}`], status: 'done' }));
    }
  };

  const handleFactoryReset = async () => {
    // This is a destructive operation.
    console.log('FACTORY RESET INITIATED');
    setCleanupData({ duplicates: [], status: 'deleting', log: ['FACTORY RESET INITIATED...', 'Step 1: Fetching ALL treks and tasks from database...'] });
    setIsCleanupModalOpen(true);
    
    try {
      const treksSnapshot = await getDocs(collection(db, 'treks'));
      const tasksSnapshot = await getDocs(collection(db, 'tasks'));
      
      const allRefs = [
        ...treksSnapshot.docs.map(d => d.ref),
        ...tasksSnapshot.docs.map(d => d.ref)
      ];
      
      console.log(`Found ${treksSnapshot.docs.length} treks and ${tasksSnapshot.docs.length} tasks to delete.`);
      setCleanupData(prev => ({ ...prev, log: [...prev.log, `Found ${treksSnapshot.docs.length} treks and ${tasksSnapshot.docs.length} tasks to delete.`] }));
      
      if (allRefs.length === 0) {
        setCleanupData(prev => ({ ...prev, status: 'done', log: [...prev.log, 'Database is already empty.'] }));
        return;
      }

      // Execute in batches of 500
      let deletedCount = 0;
      for (let i = 0; i < allRefs.length; i += 500) {
        const batch = writeBatch(db);
        const chunk = allRefs.slice(i, i + 500);
        chunk.forEach(ref => batch.delete(ref));
        await batch.commit();
        deletedCount += chunk.length;
        setCleanupData(prev => ({ ...prev, log: [...prev.log, `Deleted ${deletedCount}/${allRefs.length} items...`] }));
      }
      
      setCleanupData(prev => ({ ...prev, status: 'done', log: [...prev.log, 'FACTORY RESET COMPLETE. Database is now clean.'] }));
      
      // Clear local state
      setTreks([]);
      setTasks([]);
      
      setTimeout(() => window.location.reload(), 2000);
    } catch (error: any) {
      console.error('Factory Reset Error:', error);
      setCleanupData(prev => ({ ...prev, status: 'done', log: [...prev.log, `ERROR: ${error.message}`] }));
    }
  };

  const handleLogout = () => signOut(auth);

  const stats = useMemo(() => {
    const activeTreks = treks.filter(t => t.status === 'active');
    return {
      totalTreks: treks.length,
      activeTrips: activeTreks.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      overdue: tasks.filter(t => t.status === 'pending' && selectedTrek && isOverdue(selectedTrek.startDate, t.deadlineOffset)).length
    };
  }, [treks, tasks, selectedTrek]);

  const regionStats = useMemo(() => {
    return REGIONS.map(region => {
      const regionTreks = treks.filter(t => t.region === region);
      const active = regionTreks.filter(t => t.status === 'active').length;
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
    
    cats.forEach(cat => {
      const catTasks = tasks.filter(t => t.category === cat);
      progress[cat] = {
        completed: catTasks.filter(t => t.status === 'completed' || t.isNA).length,
        total: catTasks.length
      };
    });
    return progress;
  }, [tasks, selectedTrek]);

  const overallProgress = useMemo(() => {
    if (tasks.length === 0) return 0;
    const completed = tasks.filter(t => t.status === 'completed' || t.isNA).length;
    return Math.round((completed / tasks.length) * 100);
  }, [tasks]);

  if (treksError) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-red-100 p-4 rounded-full mb-6">
          <AlertCircle className="w-12 h-12 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Something went wrong</h1>
        <div className="bg-white border border-red-200 p-4 rounded-xl max-w-md mb-8">
          <p className="text-red-600 font-mono text-sm break-words">{treksError}</p>
        </div>
        <button 
          onClick={() => window.location.reload()}
          className="bg-emerald-600 text-white font-bold px-8 py-3 rounded-xl shadow-lg hover:bg-emerald-700 transition-all"
        >
          Try Refreshing
        </button>
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
          className="flex items-center gap-3 bg-white border border-slate-200 text-slate-700 font-bold px-8 py-4 rounded-2xl shadow-sm hover:shadow-md transition-all active:scale-[0.98] mb-6"
        >
          <LogIn className="w-5 h-5 text-emerald-600" />
          Sign in with Google
        </button>

        <div className="max-w-xs text-center">
          <p className="text-xs text-slate-400 mb-4 italic">
            Trouble signing in? Incognito mode or browser settings may block the login window.
          </p>
          <a 
            href={window.location.origin}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-blue-600 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all animate-pulse"
          >
            <ExternalLink className="w-4 h-4" />
            Open in New Tab to Login
          </a>
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
            <a 
              href={window.location.origin}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="Open in New Tab (Fixes Login Issues)"
            >
              <ExternalLink className="w-5 h-5" />
            </a>
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
                  className={`px-3 py-2 rounded-xl transition-all flex items-center gap-2 border shadow-sm ${
                    isGoogleConnected 
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100' 
                      : 'bg-white border-slate-200 text-slate-700 hover:border-emerald-400 hover:bg-emerald-50/30'
                  }`}
                  title={isGoogleConnected ? "Google Drive Connected" : "Connect Google Drive"}
                >
                  <div className="w-5 h-5 flex items-center justify-center bg-white rounded-lg shadow-sm border border-slate-100">
                    <Cloud className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline">
                    {isGoogleConnected ? "Connected" : "Connect Drive"}
                  </span>
                </button>
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
            <button 
              onClick={() => window.location.reload()}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button 
              onClick={handleScanDuplicates}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"
              title="Cleanup Duplicates"
            >
              <Trash2 className="w-5 h-5" />
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
                    {treks.length === 0 && !treksError ? (
                      <button onClick={() => setIsSalesModalOpen(true)} className="text-[10px] text-emerald-600 font-bold underline">
                        Import from Sales
                      </button>
                    ) : (
                      <div className="flex flex-col gap-1 items-center">
                        <button onClick={handleScanDuplicates} className="text-[10px] text-rose-600 font-bold underline opacity-60 hover:opacity-100 transition-opacity">
                          Cleanup Duplicates
                        </button>
                        <button onClick={handleFixDatabase} className="text-[10px] text-emerald-600 font-bold underline opacity-60 hover:opacity-100 transition-opacity">
                          Fix Regions & Tasks
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

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
                        <h3 className="font-bold text-slate-800 text-lg leading-tight">{trek.name}</h3>
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
                  {tasks.filter(t => t.category === selectedCategory).length === 0 && (
                    <div className="text-center py-12 bg-white rounded-3xl border border-dashed border-slate-200">
                      <p className="text-slate-400 text-sm font-medium mb-4">No tasks found in this category.</p>
                      <button 
                        onClick={handleFixDatabase}
                        className="bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-6 py-3 rounded-xl shadow-lg shadow-emerald-100"
                      >
                        Generate Tasks
                      </button>
                    </div>
                  )}
                  {tasks
                    .filter(t => t.category === selectedCategory)
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
                                            .filter(d => !selectedTrek?.region || d.region === selectedTrek.region)
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
                                          {staff.filter(s => s.role?.toUpperCase() !== 'COOK').map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
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
                                          {task.fileUrl ? (
                                            <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                                              <div className="flex items-center gap-2 text-emerald-700">
                                                <FileText className="w-4 h-4" />
                                                <span className="text-xs font-bold truncate max-w-[150px]">Voucher Uploaded</span>
                                              </div>
                                                  <div className="flex items-center gap-3">
                                                    {task.isScanned && isGoogleConnected && isAdminMode && (
                                                      <button
                                                        onClick={() => handleSyncToSheets(task)}
                                                        className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-blue-700 transition-colors shadow-sm"
                                                        title="Sync to Google Sheets"
                                                      >
                                                        <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                                                        Sync
                                                      </button>
                                                    )}
                                                    {isAdminMode && (
                                                      <button
                                                        onClick={() => handleScanAndSave(task)}
                                                        className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors shadow-sm"
                                                        title="AI Scan & Save"
                                                      >
                                                        <TrendingUp className="w-3 h-3" />
                                                        Scan
                                                      </button>
                                                    )}
                                                    <a 
                                                      href={task.fileUrl} 
                                                      target="_blank" 
                                                      rel="noopener noreferrer"
                                                      className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline"
                                                    >
                                                      View
                                                    </a>
                                                    {!isReadOnly && (
                                                      <button
                                                        onClick={() => handleDeleteFile(task.id, task.fileUrl)}
                                                        className="p-1 text-rose-500 hover:bg-rose-100 rounded-lg transition-colors"
                                                        title="Delete file"
                                                      >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                      </button>
                                                    )}
                                                  </div>
                                            </div>
                                          ) : (
                                            <label className="w-full border-2 border-dashed border-slate-200 rounded-2xl py-3 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-all cursor-pointer">
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
                                                  <Upload className="w-4 h-4" />
                                                  <span className="text-xs font-bold uppercase tracking-wider">Upload cash voucher...</span>
                                                </>
                                              )}
                                            </label>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {task.type === 'file' && !task.isNA && (
                                    <div className="space-y-2">
                                      {task.fileUrl ? (
                                        <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                                          <div className="flex items-center gap-2 text-emerald-700">
                                            <FileText className="w-4 h-4" />
                                            <span className="text-xs font-bold truncate max-w-[150px]">File Uploaded</span>
                                          </div>
                                          <div className="flex items-center gap-3">
                                            {task.isScanned && isGoogleConnected && isAdminMode && (
                                              <button
                                                onClick={() => handleSyncToSheets(task)}
                                                className="flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-blue-700 transition-colors shadow-sm"
                                                title="Sync to Google Sheets"
                                              >
                                                <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                                                Sync
                                              </button>
                                            )}
                                            {task.isScanned && (
                                              <div className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-[9px] font-black uppercase tracking-wider border border-blue-200">
                                                <CheckCircle2 className="w-3 h-3" />
                                                Scanned
                                              </div>
                                            )}
                                            {isAdminMode && (
                                              <button
                                                onClick={() => handleScanAndSave(task)}
                                                className="flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase tracking-wider hover:bg-emerald-700 transition-colors shadow-sm"
                                                title="AI Scan & Save"
                                              >
                                                <TrendingUp className="w-3 h-3" />
                                                Scan
                                              </button>
                                            )}
                                            <a 
                                              href={task.fileUrl} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="text-[10px] font-black text-emerald-600 uppercase tracking-widest hover:underline"
                                            >
                                              View
                                            </a>
                                            {!isReadOnly && (
                                              <button
                                                onClick={() => handleDeleteFile(task.id, task.fileUrl)}
                                                className="p-1 text-rose-500 hover:bg-rose-100 rounded-lg transition-colors"
                                                title="Delete file"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ) : !isReadOnly && (
                                        <label className="w-full border-2 border-dashed border-slate-200 rounded-2xl py-3 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-all cursor-pointer">
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
                                              <Upload className="w-4 h-4" />
                                              <span className="text-xs font-bold uppercase tracking-wider">Choose file...</span>
                                            </>
                                          )}
                                        </label>
                                      )}
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
                  ))}
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

      {/* Cleanup Modal */}
      <AnimatePresence>
        {isCleanupModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => cleanupData.status !== 'deleting' && setIsCleanupModalOpen(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden p-8 text-center">
              {cleanupData.status === 'scanning' && (
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
                    <RefreshCw className="w-8 h-8 animate-spin" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Scanning for Duplicates</h3>
                  <p className="text-slate-500 text-sm">Checking your trek list for identical names and dates...</p>
                </div>
              )}

              {cleanupData.status === 'found' && (
                <div className="space-y-6">
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">
                      {cleanupData.duplicates.length > 0 ? `${cleanupData.duplicates.length} Duplicates Found` : 'No Duplicates Found'}
                    </h3>
                    <p className="text-slate-500 text-sm mt-2">
                      {cleanupData.duplicates.length > 0 
                        ? 'We found treks with the same name and start date. Would you like to remove them?' 
                        : 'Your trek list is clean! No identical treks were found.'}
                    </p>
                  </div>

                  {cleanupData.duplicates.length > 0 && (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-left max-h-32 overflow-y-auto">
                      <p className="text-[10px] font-bold text-amber-800 uppercase mb-2">Preview of Duplicates to Delete (Showing first 50):</p>
                      {cleanupData.duplicates.slice(0, 50).map((d, i) => (
                        <p key={i} className="text-[10px] font-mono text-amber-700">
                          • {d.name} ({getTrekDateString(d.startDate)})
                        </p>
                      ))}
                      {cleanupData.duplicates.length > 20 && (
                        <p className="text-[10px] font-mono text-amber-700 italic">...and {cleanupData.duplicates.length - 20} more</p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setIsCleanupModalOpen(false)}
                      className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-400 hover:bg-slate-50 transition-colors"
                    >
                      {cleanupData.duplicates.length > 0 ? 'Cancel' : 'Close'}
                    </button>
                    {cleanupData.duplicates.length > 0 && (
                      <button 
                        onClick={handleExecuteCleanup}
                        className="flex-1 bg-rose-600 text-white font-bold px-6 py-3 rounded-xl shadow-lg shadow-rose-100 hover:bg-rose-700 transition-all"
                      >
                        Delete All
                      </button>
                    )}
                  </div>

                  {/* Danger Zone */}
                  <div className="pt-4 border-t border-slate-100">
                    {!showFactoryResetConfirm ? (
                      <button 
                        onClick={() => setShowFactoryResetConfirm(true)}
                        className="text-[10px] font-bold text-rose-400 uppercase tracking-widest hover:text-rose-600 transition-colors"
                      >
                        Factory Reset (Wipe All Data)
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-[10px] font-bold text-rose-600 uppercase">Are you absolutely sure? This deletes EVERYTHING.</p>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setShowFactoryResetConfirm(false)}
                            className="flex-1 py-2 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-bold uppercase"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={() => {
                              setShowFactoryResetConfirm(false);
                              handleFactoryReset();
                            }}
                            className="flex-1 py-2 bg-rose-600 text-white rounded-lg text-[10px] font-bold uppercase"
                          >
                            Yes, Wipe All
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {cleanupData.status === 'deleting' && (
                <div className="space-y-4">
                  <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
                    <RefreshCw className="w-8 h-8 animate-spin" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800">Removing Duplicates</h3>
                  <div className="bg-slate-50 rounded-xl p-3 text-left max-h-32 overflow-y-auto">
                    {cleanupData.log.map((msg, i) => (
                      <p key={i} className="text-[10px] font-mono text-slate-500">{msg}</p>
                    ))}
                  </div>
                </div>
              )}

              {cleanupData.status === 'done' && (
                <div className="space-y-6">
                  {cleanupData.log.some(l => l.startsWith('ERROR')) ? (
                    <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto">
                      <AlertTriangle className="w-8 h-8" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">
                      {cleanupData.log.some(l => l.startsWith('ERROR')) ? 'Cleanup Aborted' : 'Cleanup Complete'}
                    </h3>
                    <div className="bg-slate-50 rounded-xl p-3 text-left mb-4">
                      {cleanupData.log.slice(-5).map((msg, i) => (
                        <p key={i} className={`text-[10px] font-mono ${msg.startsWith('ERROR') ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                          {msg}
                        </p>
                      ))}
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsCleanupModalOpen(false)}
                    className="w-full bg-slate-900 text-white font-bold px-6 py-3 rounded-xl hover:bg-slate-800 transition-all"
                  >
                    Back to Dashboard
                  </button>
                </div>
              )}
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
