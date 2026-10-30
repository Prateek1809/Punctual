import { Component, inject, signal, OnInit, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatRadioModule } from '@angular/material/radio';
import { MatSliderModule } from '@angular/material/slider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { SettingsService, DEFAULT_SETTINGS } from '../../../core/settings.service';
import { LocationService } from '../../../core/location.service';
import { AttendancePolicy, AttendancePolicyMode, AttendanceOnFailure, OfficeLocation } from '../../../core/models';
import * as L from 'leaflet';

@Component({
  selector: 'app-attendance-policy',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatRadioModule,
    MatSliderModule,
    MatSnackBarModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './attendance-policy.html'
})
export class AttendancePolicyComponent implements OnInit, AfterViewInit, OnDestroy {
  private fb = inject(FormBuilder);
  private settingsService = inject(SettingsService);
  private locationService = inject(LocationService);
  private snackBar = inject(MatSnackBar);

  isSaving = signal(false);
  isLoadingLocation = signal(false);
  isFetchingIp = signal(false);

  allowedIps = signal<string[]>([]);
  newIpInput = signal('');

  // Leaflet map instances
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private circle: L.Circle | null = null;

  policyForm = this.fb.group({
    mode: ['either' as AttendancePolicyMode, Validators.required],
    onFailure: ['flag' as AttendanceOnFailure, Validators.required],
    maxAccuracyM: [300, [Validators.required, Validators.min(10)]],
    officeName: ['', Validators.required],
    officeLat: [null as number | null, Validators.required],
    officeLng: [null as number | null, Validators.required],
    radiusM: [200, [Validators.required, Validators.min(10)]]
  });

  ngOnInit() {
    this.settingsService.getSettings().subscribe(settings => {
      const p = settings.attendancePolicy || { mode: 'either', onFailure: 'flag', maxAccuracyM: 300, allowedIps: [], offices: [] };
      const office = p.offices?.[0];

      if (office && office.lat != null && office.lng != null) {
        this.policyForm.patchValue({
          mode: p.mode || 'either',
          onFailure: p.onFailure || 'flag',
          maxAccuracyM: p.maxAccuracyM || 300,
          officeName: office.name || '',
          officeLat: office.lat,
          officeLng: office.lng,
          radiusM: office.radiusM || 200
        });
      } else {
        this.policyForm.patchValue({
          mode: p.mode || 'either',
          onFailure: p.onFailure || 'flag',
          maxAccuracyM: p.maxAccuracyM || 300,
          officeName: office?.name || '',
          radiusM: office?.radiusM || 200
        });
      }

      this.allowedIps.set(p.allowedIps || []);
      this.updateMapLayers();
    });

    // Update map circle when radius or lat/lng inputs change
    this.policyForm.valueChanges.subscribe(() => {
      this.updateMapLayers();
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.initLeafletMap();
    }, 200);
  }

  ngOnDestroy() {
    if (this.map) {
      this.map.remove();
    }
  }

  private initLeafletMap() {
    const mapElement = document.getElementById('policy-map');
    if (!mapElement || this.map) return;

    const latVal = this.policyForm.get('officeLat')?.value;
    const lngVal = this.policyForm.get('officeLng')?.value;
    const hasCoords = latVal != null && lngVal != null && !isNaN(Number(latVal)) && !isNaN(Number(lngVal));

    const defaultLat = hasCoords ? Number(latVal) : 20.5937;
    const defaultLng = hasCoords ? Number(lngVal) : 78.9629;
    const zoomLevel = hasCoords ? 16 : 5;

    // Create custom pin icon
    const defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    this.map = L.map('policy-map').setView([defaultLat, defaultLng], zoomLevel);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(this.map);

    if (hasCoords) {
      this.marker = L.marker([defaultLat, defaultLng], { draggable: true, icon: defaultIcon }).addTo(this.map);
      this.circle = L.circle([defaultLat, defaultLng], {
        radius: Number(this.policyForm.get('radiusM')?.value) || 200,
        color: '#4f46e5',
        fillColor: '#6366f1',
        fillOpacity: 0.2
      }).addTo(this.map);

      // Drag marker updates lat & lng
      this.marker.on('dragend', () => {
        const pos = this.marker!.getLatLng();
        this.policyForm.patchValue({
          officeLat: Number(pos.lat.toFixed(6)),
          officeLng: Number(pos.lng.toFixed(6))
        });
        this.updateMapLayers();
      });
    }

    // Clicking map places or moves marker
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      this.policyForm.patchValue({
        officeLat: Number(e.latlng.lat.toFixed(6)),
        officeLng: Number(e.latlng.lng.toFixed(6))
      });
      this.updateMapLayers();
    });
  }

  private updateMapLayers() {
    if (!this.map) return;

    const latVal = this.policyForm.get('officeLat')?.value;
    const lngVal = this.policyForm.get('officeLng')?.value;
    if (latVal == null || lngVal == null) return;

    const lat = Number(latVal);
    const lng = Number(lngVal);
    const radius = Number(this.policyForm.get('radiusM')?.value) || 200;

    if (isNaN(lat) || isNaN(lng)) return;

    const defaultIcon = L.icon({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    });

    if (!this.marker) {
      this.marker = L.marker([lat, lng], { draggable: true, icon: defaultIcon }).addTo(this.map);
      this.circle = L.circle([lat, lng], {
        radius,
        color: '#4f46e5',
        fillColor: '#6366f1',
        fillOpacity: 0.2
      }).addTo(this.map);

      this.marker.on('dragend', () => {
        const pos = this.marker!.getLatLng();
        this.policyForm.patchValue({
          officeLat: Number(pos.lat.toFixed(6)),
          officeLng: Number(pos.lng.toFixed(6))
        });
        this.updateMapLayers();
      });
    } else {
      const newLatLng = new L.LatLng(lat, lng);
      this.marker.setLatLng(newLatLng);
      if (this.circle) {
        this.circle.setLatLng(newLatLng);
        this.circle.setRadius(radius);
      }
    }
  }

  async useCurrentLocation() {
    this.isLoadingLocation.set(true);
    try {
      const pos = await this.locationService.getPosition();
      if (!pos) {
        throw new Error('Could not access device location. Please allow browser location permissions.');
      }

      this.policyForm.patchValue({
        officeLat: Number(pos.lat.toFixed(6)),
        officeLng: Number(pos.lng.toFixed(6)),
        maxAccuracyM: Math.max(300, Math.ceil(pos.accuracy * 1.5))
      });

      if (this.map) {
        this.map.setView([pos.lat, pos.lng], 16);
      }
      this.updateMapLayers();

      this.snackBar.open(`Captured coordinates: ${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)}`, 'Close', {
        duration: 3500
      });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error obtaining location', 'Close', { duration: 4000 });
    } finally {
      this.isLoadingLocation.set(false);
    }
  }

  async addCurrentIp() {
    this.isFetchingIp.set(true);
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      if (data && data.ip) {
        this.addIpToList(data.ip);
        this.snackBar.open(`Detected current public IP: ${data.ip}`, 'Close', { duration: 3500 });
      }
    } catch {
      this.snackBar.open('Unable to automatically fetch public IP. Please type it manually.', 'Close', {
        duration: 4000
      });
    } finally {
      this.isFetchingIp.set(false);
    }
  }

  addManualIp() {
    const ip = this.newIpInput().trim();
    if (!ip) return;
    this.addIpToList(ip);
    this.newIpInput.set('');
  }

  private addIpToList(ip: string) {
    if (!this.allowedIps().includes(ip)) {
      this.allowedIps.update(list => [...list, ip]);
    }
  }

  removeIp(ip: string) {
    this.allowedIps.update(list => list.filter(item => item !== ip));
  }

  async savePolicy() {
    if (this.policyForm.invalid || this.isSaving()) return;

    this.isSaving.set(true);
    try {
      const val = this.policyForm.value;
      const office: OfficeLocation = {
        name: val.officeName!,
        lat: Number(val.officeLat),
        lng: Number(val.officeLng),
        radiusM: Number(val.radiusM)
      };

      const updatedPolicy: AttendancePolicy = {
        mode: val.mode as AttendancePolicyMode,
        onFailure: val.onFailure as AttendanceOnFailure,
        allowedIps: this.allowedIps(),
        maxAccuracyM: Number(val.maxAccuracyM),
        offices: [office]
      };

      await this.settingsService.updateSettings({ attendancePolicy: updatedPolicy });
      this.snackBar.open('Attendance verification policy saved successfully!', 'Close', { duration: 4000 });
    } catch (e: any) {
      this.snackBar.open(e.message || 'Error saving policy', 'Close', { duration: 4000 });
    } finally {
      this.isSaving.set(false);
    }
  }
}
